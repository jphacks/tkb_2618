// DeskAPI センサー値の連続送信（Seeed XIAO ESP32S3）
//
// D0・D1・D3・D4（左上・右上・左下・右下）の ADC 生値を、1chあたり毎秒4000回読んで、
// 1行に4ch分をカンマ区切りで USB シリアルに送るだけ。打撃の判定はすべて PC 側で行う（docs/decisions.md）。
//   例: 1923,2101,2088,2240
// Arduino IDE のシリアルプロッタでもそのまま4本の波形として見られる。
// "[" で始まる行は状態表示（起動時と、1秒ごとの実効レート・送れなかった行数）。
//
// 確認用の表示モード：シリアルモニタから "view" と送ると、0.25秒ごとに各chの振れ幅（基準値からの最大のずれ）を
// 1行で出す。読み取りは毎秒4000回のままなので、叩いた瞬間の山も取りこぼさない。"stream" で元に戻る。

#include <esp_random.h>

const uint8_t PINS[4] = {D0, D1, D3, D4};  // D2(GPIO3) はストラッピングピンなので使わない
const char *NAMES[4] = {"D0", "D1", "D3", "D4"};
const uint32_t PERIOD_US = 250;            // 4000回/秒/ch
const uint32_t VIEW_MS = 250;              // 表示モードで1行出す間隔
const float BASE_RATE = 1.0f / 4096;       // 基準値の追従（約1秒）
const int BAR_STEP = 50;                   // 表示モードの棒グラフ：# 1つ = 50カウント

uint32_t nextUs;
uint32_t sent = 0, dropped = 0, statAtMs = 0;

bool viewMode = false;
float base[4];
uint16_t viewMax[4], viewMin[4];
uint32_t viewAtMs = 0;
char cmd[16];
uint8_t cmdLen = 0;

void resetView() {
  for (int i = 0; i < 4; i++) {
    viewMax[i] = 0;
    viewMin[i] = 4095;
  }
}

void printView() {
  // D0 は詳しく、他は振れ幅だけ
  int dev0 = max((int)viewMax[0] - (int)base[0], (int)base[0] - (int)viewMin[0]);
  char bar[41];
  int n = constrain(dev0 / BAR_STEP, 0, 40);
  for (int i = 0; i < n; i++) bar[i] = '#';
  bar[n] = '\0';
  Serial.printf("[view] D0 基準%4d 振れ幅%5d (最小%4u 最大%4u) %-40s", (int)base[0], dev0, viewMin[0], viewMax[0], bar);
  for (int i = 1; i < 4; i++) {
    int dev = max((int)viewMax[i] - (int)base[i], (int)base[i] - (int)viewMin[i]);
    Serial.printf(" | %s %4d", NAMES[i], dev);
  }
  Serial.println();
}

void pollCommand() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (cmdLen < sizeof(cmd) - 1) cmd[cmdLen++] = c;
      continue;
    }
    cmd[cmdLen] = '\0';
    cmdLen = 0;
    if (!strcmp(cmd, "view")) {
      viewMode = true;
      resetView();
      viewAtMs = millis();
      Serial.printf("[desk] 表示モード：%lums ごとに振れ幅を出します（# 1つ = %dカウント）。stream で戻ります\n",
                    (unsigned long)VIEW_MS, BAR_STEP);
    } else if (!strcmp(cmd, "stream")) {
      viewMode = false;
      Serial.println("[desk] 連続送信に戻りました");
    }
  }
}

void setup() {
#if ARDUINO_USB_MODE
  Serial.setTxBufferSize(8192);  // 送信の待ち行列を広げて、取りこぼしを減らす
#endif
  Serial.begin(115200);
#if ARDUINO_USB_MODE
  Serial.setTxTimeoutMs(0);  // PCが読んでいなくても止まらない
#endif
  analogReadResolution(12);
  delay(300);
  for (int i = 0; i < 4; i++) base[i] = analogRead(PINS[i]);
  resetView();
  Serial.printf("[desk] stream boot=%lu ch=D0,D1,D3,D4 rate=4000\n", (unsigned long)esp_random());
  nextUs = micros();
}

void loop() {
  pollCommand();
  if ((int32_t)(micros() - nextUs) < 0) return;
  nextUs += PERIOD_US;

  uint16_t v[4];
  for (int i = 0; i < 4; i++) {
    v[i] = analogRead(PINS[i]);
    base[i] += (v[i] - base[i]) * BASE_RATE;
  }

  uint32_t now = millis();
  if (viewMode) {
    for (int i = 0; i < 4; i++) {
      if (v[i] > viewMax[i]) viewMax[i] = v[i];
      if (v[i] < viewMin[i]) viewMin[i] = v[i];
    }
    if (now - viewAtMs >= VIEW_MS) {
      printView();
      resetView();
      viewAtMs = now;
    }
  } else {
    char line[32];
    int n = snprintf(line, sizeof(line), "%u,%u,%u,%u\n", v[0], v[1], v[2], v[3]);
    // 行の途中で切れないよう、丸ごと入るときだけ送る
    if (Serial.availableForWrite() >= n) {
      Serial.write((const uint8_t *)line, n);
      sent++;
    } else {
      dropped++;
    }
    if (now - statAtMs >= 1000) {
      Serial.printf("[stat] rate=%lu dropped=%lu\n", (unsigned long)sent, (unsigned long)dropped);
      sent = dropped = 0;
      statAtMs = now;
    }
  }

  if ((int32_t)(micros() - nextUs) > 10000) nextUs = micros();  // 大きく遅れたら追いかけない
}
