import { Enter, MUTED, Page } from '../common'

export function Answer() {
  return <Page>
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <Enter>
        <h1 style={{ fontSize: 80, fontWeight: 800 }}>机をノックして、PC を操作する。</h1>
        <p style={{ fontSize: 36, color: MUTED, marginTop: 36 }}>DaaS = Desktop as a Service</p>
      </Enter>
    </div>
  </Page>
}
