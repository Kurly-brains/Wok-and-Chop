import Link from "next/link";
import InkInscription from "./ink-inscription";
import RoundTable from "./round-table";
import "../styles/layered-home.css";
export default function HomeContent() {
  const picks = [
    {
      id: "noodles",
      label: "Noodles",
      image: "noodles-cutout.webp",
      tone: "ochre",
    },
    {
      id: "wok",
      label: "From the wok",
      image: "chicken-cutout.webp",
      tone: "jade",
    },
    {
      id: "starters",
      label: "Small plates",
      image: "spring-rolls-cutout.webp",
      tone: "red",
    },
  ];
  return (
    <>
      <section
        className="layer-hero has-round-table"
        aria-labelledby="hero-title"
      >
        <p className="layer-hero-kicker inscription-line">
          <InkInscription>開飯</InkInscription> Hakka Chinese. Kanata at heart.
        </p>
        <h1 id="hero-title">
          Big wok.
          <br />
          <strong>Bold flavour.</strong>
        </h1>
        <RoundTable />
        <div className="layer-hero-invitation">
          <p>
            A little heat.
            <br />A generous helping.
            <br />
            Pull up a chair.
          </p>
          <Link href="/menu/" className="primary-button">
            Explore the menu <span>↗</span>
          </Link>
        </div>
        <div className="hero-halal">
          <span>Fresh.</span>
          <span>Flavorful.</span>
          <strong>100% Halal.</strong>
        </div>
        <img
          className="hero-headline-chopsticks hero-headline-chopsticks--left"
          src="/images/chopsticks-cutout.webp"
          width={118}
          height={1100}
          alt=""
          aria-hidden="true"
        />
        <img
          className="hero-headline-chopsticks hero-headline-chopsticks--right"
          src="/images/chopsticks-cutout.webp"
          width={118}
          height={1100}
          alt=""
          aria-hidden="true"
        />
      </section>
      <section className="food-showcase" aria-labelledby="showcase-title">
        <div className="showcase-heading">
          <p className="handwritten">Something for the whole table.</p>
          <h2 id="showcase-title">
            Find your kind of <strong>flavour.</strong>
          </h2>
          <p>Browse the menu, one craving at a time.</p>
        </div>
        <div className="food-stage-list">
          {picks.map((pick) => (
            <article key={pick.id} className={`food-stage ${pick.tone}`}>
              <div className="food-stage-panel">
                <span>{pick.label}</span>
              </div>
              <Link
                className="food-stage-image"
                href={`/menu/?category=${pick.id}`}
                aria-label={`Explore ${pick.label}`}
              >
                <img
                  src={`/images/${pick.image}`}
                  alt={pick.label}
                  width="850"
                  height="850"
                  loading="lazy"
                />
              </Link>
              <div className="food-stage-caption">
                <Link className="text-link" href={`/menu/?category=${pick.id}`}>
                  Explore {pick.label.toLowerCase()}{" "}
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
        <div className="showcase-bottom">
          <Link className="text-link" href="/menu/">
            Explore the full menu <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </>
  );
}
