import Link from "next/link";
import InkInscription from "./ink-inscription";
import "../styles/story-page.css";

export function StoryContent() {
  return (
    <div className="wc-story-page">
      <section className="wc-story-hero" aria-labelledby="story-title">
        <div className="wc-story-hero-copy">
          <p className="wc-story-kicker">Our story</p>
          <h1 id="story-title">
            Hakka Chinese.
            <span>Kanata at heart.</span>
          </h1>
          <p>
            We’re Wok &amp; Chop, a Halal Hakka Chinese kitchen on Kanata Avenue.
            Bold flavours, wok-tossed favourites, and a menu made for a good appetite.
          </p>
          <Link className="wc-story-menu-link" href="/menu/">
            Get to know the menu <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <figure className="wc-story-art">
          <InkInscription stamp="客家">鑊氣</InkInscription>
          <img
            src="/images/art/wok-kitchen.webp"
            width={1200}
            height={800}
            alt="Ink and watercolour illustration of a wok over a flame, with garlic, chillies and scallions"
          />
        </figure>
      </section>

      <section className="wc-story-food" aria-labelledby="story-food-title">
        <h2 id="story-food-title">Hakka cooking<br /> in Canada.</h2>
        <div className="wc-story-food-copy">
          {/* Cuisine history: https://wokandchop.ca/hakka-cuisine-in-canada-a-story-of-migration-adaptation-and-flavor/ */}
          <p>
            Chinese immigrant cooks combined their cooking techniques
            with Indian spices and ingredients. Families later brought this
            Indo-Chinese Hakka style to Canada, where it found a place in
            neighbourhood restaurants.
          </p>
          <p>
            That meeting of flavours is on our menu here in Kanata: in the chilli
            and garlic of Chilli Chicken, the stir-fried noodles, and the tangy
            gravy of Veg Manchurian.
          </p>
          <ul aria-label="Explore dishes from our menu">
            <li><Link href="/menu/?category=lunch-chicken">Chilli Chicken <span aria-hidden="true">↗</span></Link></li>
            <li><Link href="/menu/?category=lunch-rice-noodles">Chicken Chow Mein <span aria-hidden="true">↗</span></Link></li>
            <li><Link href="/menu/?category=lunch-vegetarian">Veg Manchurian <span aria-hidden="true">↗</span></Link></li>
          </ul>
        </div>
        <div className="wc-story-halal">
          <strong>100% Halal.</strong>
          <p>With vegetarian choices alongside our chicken, beef and fish dishes.</p>
        </div>
      </section>

      <section className="wc-story-family" aria-labelledby="story-family-title">
        <img
          className="wc-story-family-photo"
          src="/images/art/shared-family-meal.webp"
          alt="A child holding a bowl of soup at a shared meal"
          width={1599}
          height={900}
          loading="lazy"
          decoding="async"
        />
        <div className="wc-story-family-inner">
          <div className="wc-story-family-copy">
            <h2 id="story-family-title">Pass the bowl.</h2>
            <p>
              When there’s chilli chicken on the table, save a spoonful of gravy
              for the noodles. Pass the rice around and split the last spring roll.
            </p>
            <p>
              That’s how we like to eat at Wok &amp; Chop in Kanata, with the dishes
              in the middle and everyone within reach.
            </p>
          </div>
        </div>
      </section>

      <section className="wc-story-find" aria-labelledby="story-find-title">
        <h2 id="story-find-title">Find us in Kanata.</h2>
        <address>790 Kanata Ave, Unit M2A<br />Kanata, Ontario</address>
        <Link className="wc-story-visit-link" href="/contact/">
          Contact us <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </div>
  );
}

export default StoryContent;
