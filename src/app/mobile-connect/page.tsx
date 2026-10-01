import { KeyRound, LockKeyhole, MonitorSmartphone } from "lucide-react";

import { MobileConnectForm } from "@/components/MobileConnectForm";

export default function MobileConnectPage() {
  return (
    <main className="mobile-connect-page">
      <section className="mobile-connect-card">
        <span className="mobile-connect-icon"><LockKeyhole size={30} /></span>
        <span className="eyebrow">可信裝置防護</span>
        <h1>把這台手機連到頌祖音樂 OS。</h1>
        <p>請先在 Mac 桌面 App 的「本機 App」頁產生短效配對碼，再輸入下方欄位。完成後可直接用 Safari 或 Chrome 操作。</p>
        <MobileConnectForm />
        <div className="mobile-connect-steps">
          <span><MonitorSmartphone size={18} /><b>Mac</b> 打開「本機 App → 手機與主機安全配對」</span>
          <span><KeyRound size={18} /><b>手機</b> 輸入短效配對碼後自動進入工作台</span>
        </div>
      </section>
    </main>
  );
}
