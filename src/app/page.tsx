import ClubApp from "@/components/ClubApp";
export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.APP_MODE === "production")
    return (
      <main className="production-gate">
        <div className="brand-mark">
          B<span>↗</span>
        </div>
        <p className="eyebrow">BOJI CLUB / PRODUCTION</p>
        <h1>生产服务尚未开放</h1>
        <p>
          当前交付包含可运行演示与服务端
          API。真实账号前端、供应商接入和数据库隔离验收完成后才能开放生产服务。
        </p>
        <p>演示不会在生产模式下自动启用。部署检查见项目 RELEASE_GATES.md。</p>
      </main>
    );
  return <ClubApp />;
}
