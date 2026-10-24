// SVG paths, colors, labels and defaults copied from docs/design/settings.dc.html.
import type { Action, ColorId, Config, DeskKey, IconId } from './types'

export const IC = {
  "mic": "M12 2a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 0 0 7 0v-6A3.5 3.5 0 0 0 12 2z M5.5 10.5h1.6v1a4.9 4.9 0 0 0 9.8 0v-1h1.6v1a6.5 6.5 0 0 1-5.7 6.45v2.55h3v1.6H8.2v-1.6h3v-2.55A6.5 6.5 0 0 1 5.5 11.5z",
  "capture": "M3 3h6v2.2H5.2V9H3z M15 3h6v6h-2.2V5.2H15z M3 15h2.2v3.8H9V21H3z M18.8 15H21v6h-6v-2.2h3.8z M11 7h2v4h4v2h-4v4h-2v-4H7v-2h4z",
  "code": "M8.3 5.5l1.6 1.6L5 12l4.9 4.9-1.6 1.6L1.8 12z M15.7 5.5L22.2 12l-6.5 6.5-1.6-1.6L19 12l-4.9-4.9z M13.2 4l1.9.5-4.3 15.5-1.9-.5z",
  "app": "M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9v9h16V9z",
  "playpause": "M3 5.5v13l9-6.5z M15 5.5h2.5v13H15z M19.5 5.5H22v13h-2.5z",
  "next": "M3 5.5v13l8.5-6.5z M11.5 5.5v13l8.5-6.5z M20 5.5h2v13h-2z",
  "prev": "M21 5.5v13l-8.5-6.5z M12.5 5.5v13L4 12z M2 5.5h2v13H2z",
  "volume": "M3 9h4l5-4v14l-5-4H3z M15 8.2a5 5 0 0 1 0 7.6l-1.2-1.2a3.4 3.4 0 0 0 0-5.2z M17.8 5.4a9 9 0 0 1 0 13.2l-1.2-1.2a7.3 7.3 0 0 0 0-10.8z",
  "volDown": "M2 9h4l5-4v14l-5-4H2z M14 11h8v2h-8z",
  "volUp": "M2 9h4l5-4v14l-5-4H2z M17 7.5h2v3.5h3.5v2H19v3.5h-2V13h-3.5v-2H17z",
  "music": "M9 6.5l11-2.5v11.2a2.8 2.8 0 1 1-2-2.7V6.6l-7 1.6v9a2.8 2.8 0 1 1-2-2.7z",
  "terminal": "M3 6.3l1.8-1.8L12 11.7l-7.2 7.2L3 17.1l5.4-5.4z M13 17h8v2.4h-8z",
  "hammer": "M4 4h11l3 3-3 3H4z M8.5 10h3v11h-3z",
  "bubble": "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M6.5 8h11v1.8h-11z M6.5 11.6h7v1.8h-7z",
  "lock": "M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10h-2V7.5a2.5 2.5 0 0 0-5 0V10z M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M12 13.2a1.6 1.6 0 0 0-.8 3V18h1.6v-1.8a1.6 1.6 0 0 0-.8-3z",
  "keyboard": "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M5 9h2v2H5z M8.5 9h2v2h-2z M12 9h2v2h-2z M15.5 9h2v2h-2z M7 13.5h10v2H7z",
  "send": "M3 11.2L21 3l-8.2 18-2.3-7.5z",
  "layers": "M12 2l10 5-10 5L2 7z M2 12l2.2-1.1L12 15l7.8-4.1L22 12l-10 5z M2 17l2.2-1.1L12 20l7.8-4.1L22 17l-10 5z",
  "broadcast": "M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z M16.2 7.8a6 6 0 0 1 0 8.4l-1.4-1.4a4 4 0 0 0 0-5.6z M19 5a10 10 0 0 1 0 14l-1.4-1.4a8 8 0 0 0 0-11.2z M7.8 7.8l1.4 1.4a4 4 0 0 0 0 5.6l-1.4 1.4a6 6 0 0 1 0-8.4z M5 5l1.4 1.4a8 8 0 0 0 0 11.2L5 19a10 10 0 0 1 0-14z",
  "star": "M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z",
  "bolt": "M13 2L4 14h7l-1 8 9-12h-7z",
  "plus": "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  "shift": "M12 3l9 9h-5v8H8v-8H3z",
  "win": "M3 3h8.2v8.2H3z M12.8 3H21v8.2h-8.2z M3 12.8h8.2V21H3z M12.8 12.8H21V21h-8.2z"
} as const

export const ICON_LIST = [
  [
    "mic",
    "マイク"
  ],
  [
    "capture",
    "キャプチャ"
  ],
  [
    "code",
    "コード"
  ],
  [
    "app",
    "ウィンドウ"
  ],
  [
    "playpause",
    "再生"
  ],
  [
    "next",
    "次"
  ],
  [
    "volume",
    "音量"
  ],
  [
    "music",
    "音楽"
  ],
  [
    "terminal",
    "ターミナル"
  ],
  [
    "hammer",
    "ビルド"
  ],
  [
    "bubble",
    "メッセージ"
  ],
  [
    "lock",
    "ロック"
  ],
  [
    "keyboard",
    "キーボード"
  ],
  [
    "send",
    "送信"
  ],
  [
    "layers",
    "レイヤー"
  ],
  [
    "broadcast",
    "配信"
  ],
  [
    "star",
    "スター"
  ],
  [
    "bolt",
    "稲妻"
  ]
] as const

export const COLORS = [
  [
    "red",
    "#D62413",
    "#FFFFFF",
    "赤"
  ],
  [
    "yellow",
    "#D6B813",
    "#121212",
    "黄"
  ],
  [
    "green",
    "#13D66A",
    "#121212",
    "緑"
  ],
  [
    "blue",
    "#2214D6",
    "#FFFFFF",
    "青"
  ],
  [
    "indigo",
    "#3C3781",
    "#FFFFFF",
    "紺"
  ]
] as const

export const MEDIA_OPS = [
  [
    "prev",
    "前の曲"
  ],
  [
    "playpause",
    "再生 / 停止"
  ],
  [
    "next",
    "次の曲"
  ],
  [
    "volDown",
    "音量 −"
  ],
  [
    "volUp",
    "音量 +"
  ],
  [
    "mic",
    "ミュート"
  ]
] as const

export const REGIONS = [
  "左上",
  "右上",
  "左下",
  "右下"
] as const

export const PATTERNS = [
  "1回 弱",
  "1回 強",
  "2回 弱",
  "2回 強"
] as const

export const ACTS: readonly {type: Action['type']; name: string; icon: IconId; color: ColorId; action: Action}[] = [
  {
    "type": "hotkey",
    "name": "キー入力",
    "icon": "keyboard",
    "color": "blue",
    "action": {
      "type": "hotkey",
      "keys": [
        "Ctrl",
        "KeyC"
      ]
    }
  },
  {
    "type": "launch",
    "name": "アプリ",
    "icon": "app",
    "color": "indigo",
    "action": {
      "type": "launch",
      "file": "notepad.exe"
    }
  },
  {
    "type": "media",
    "name": "メディア",
    "icon": "playpause",
    "color": "green",
    "action": {
      "type": "media",
      "op": "playpause"
    }
  },
  {
    "type": "command",
    "name": "コマンド",
    "icon": "terminal",
    "color": "yellow",
    "action": {
      "type": "command",
      "cmd": "echo hello"
    }
  },
  {
    "type": "http",
    "name": "Webhook",
    "icon": "send",
    "color": "blue",
    "action": {
      "type": "http",
      "url": "https://[YOUR WEBHOOK URL]"
    }
  },
  {
    "type": "profile",
    "name": "プロファイル",
    "icon": "layers",
    "color": "red",
    "action": {
      "type": "profile",
      "to": "stream"
    }
  },
  {
    "type": "lock",
    "name": "ロック",
    "icon": "lock",
    "color": "indigo",
    "action": {
      "type": "lock"
    }
  }
]

export const DEFAULT_CONFIG: Config = {
  "version": 1,
  "profiles": [
    {
      "id": "work",
      "name": "作業",
      "keys": [
        {
          "icon": "mic",
          "slash": true,
          "color": "red",
          "action": {
            "type": "hotkey",
            "keys": [
              "Ctrl",
              "Shift",
              "KeyM"
            ]
          }
        },
        {
          "icon": "capture",
          "color": "blue",
          "action": {
            "type": "hotkey",
            "keys": [
              "Win",
              "Shift",
              "KeyS"
            ]
          }
        },
        {
          "icon": "code",
          "color": "indigo",
          "action": {
            "type": "launch",
            "file": "Code.exe"
          }
        },
        null,
        {
          "icon": "playpause",
          "color": "green",
          "action": {
            "type": "media",
            "op": "playpause"
          }
        },
        {
          "icon": "next",
          "color": "green",
          "action": {
            "type": "media",
            "op": "next"
          }
        },
        {
          "icon": "volume",
          "color": "green",
          "action": {
            "type": "media",
            "op": "volUp"
          }
        },
        {
          "icon": "music",
          "color": "yellow",
          "action": {
            "type": "launch",
            "file": "Spotify.exe"
          }
        },
        {
          "icon": "terminal",
          "color": "indigo",
          "action": {
            "type": "launch",
            "file": "wt.exe"
          }
        },
        {
          "icon": "hammer",
          "color": "yellow",
          "action": {
            "type": "command",
            "cmd": "npm run build"
          }
        },
        {
          "icon": "bubble",
          "color": "yellow",
          "action": {
            "type": "http",
            "url": "https://hooks.slack.com/services/[YOUR WEBHOOK]"
          }
        },
        null,
        {
          "icon": "broadcast",
          "color": "red",
          "action": {
            "type": "profile",
            "to": "stream"
          }
        },
        {
          "icon": "lock",
          "color": "indigo",
          "action": {
            "type": "lock"
          }
        },
        {
          "icon": "send",
          "color": "blue",
          "action": {
            "type": "http",
            "url": "https://[YOUR WEBHOOK URL]"
          }
        },
        null
      ]
    },
    {
      "id": "stream",
      "name": "配信",
      "keys": [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    },
    {
      "id": "game",
      "name": "ゲーム",
      "keys": [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    }
  ],
  "activeProfileId": "work",
  "locked": false,
  "notify": true,
  "autostart": true,
  "port": "auto",
  "protocol": "deskapi-v1"
}

export const colorOf = (id: ColorId) => COLORS.find(c => c[0] === id) ?? COLORS[4]
export function freshKey(type: Action['type'], profileId = 'stream'): DeskKey {
  const item = ACTS.find(a => a.type === type)!
  return {icon: item.icon, color: item.color, action: item.type === 'profile' ? {type: 'profile', to: profileId} : structuredClone(item.action)}
}
