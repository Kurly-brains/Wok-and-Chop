import "../styles/ink-inscription.css";

export default function InkInscription({
  children,
  stamp,
}: {
  children: string;
  stamp?: string;
}) {
  return (
    <span lang="zh-Hant" aria-hidden="true" className={stamp ? "ink-signature" : "ink-seal"}>
      {children}
      {stamp && <span className="ink-seal">{stamp}</span>}
    </span>
  );
}
