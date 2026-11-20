# Owner lunch menu and homepage brief

This records the owner-supplied lunch menu and latest presentation clarification. It supplements the original requirements pack without changing those supplied files.

## Menu source

The import contains 37 dishes at a base price of **$13.99 CAD**: Chicken 15, Beef 10, Fish 6, Vegetarian 4, and Rice & noodles 2. Source names, heat markers and the Kung Pao chicken/beef peanut markers are preserved in `packages/domain/src/lunch-menu.ts`. An absent peanut marker does not mean peanut-free; heat information is not inferred where the supplied source has no marker.

The source lunch window is **12:00–15:00, America/Toronto, excluding holidays**. No weekday schedule, general opening hours or holiday calendar has been invented. Each imported entrée has jasmine rice, a vegetable spring roll and a choice of soup of the day or pop. Required modifier groups model the rice accompaniment and soup/pop choice. Fried-rice substitution adds **250 cents**. Chicken, beef, fish and vegetarian entries also have regular/gravy or dry preparation, with dry adding **100 cents**. The two Rice & noodles entries omit that preparation group. Listed Chilli/Hot Garlic/Szechuan or Hakka/Manchurian/Szechuan style choices are separate required options.

Exports are `lunchMenuItems`, `lunchCategories`, `lunchMenuDetails`, and `isLunchMenuItem`. Lunch IDs begin with `lunch-`; category IDs are `lunch-chicken`, `lunch-beef`, `lunch-fish`, `lunch-vegetarian`, and `lunch-rice-noodles`. The shared local catalog contains these 37 items plus the original nine sample items so existing saved carts and overrides remain readable. Public lunch presentation and the editor use the lunch subset.

## Latest accepted presentation

- Preserve the original red homepage hero and original food-category sections exactly. Their composition is not replaced by a carousel or a conventional menu grid.
- Add **one separate lower homepage section** of four standalone Chinese-food stories in an infinitely looping, freely draggable track. Show partial neighbouring cards and navigation controls, without a percentage or progress bar. Responsive layouts must keep the food image, story text and controls usable without page-wide overflow.
- Use pure white (`#ffffff`) site surfaces and tighter spacing. Make “Chinese roots. Hakka soul.” a compact text-only intro with the noodle artwork removed.
- Display the actual lunch menu on `/menu/` with a **full-width food-photo banner, outlined category filters and a photo grid**. Use four dish columns on desktop and two on mobile. The earlier paper/hover menu is superseded.
- The lower homepage cards are **standalone editorial food stories**: no prices, lunch labels, order buttons or menu-driven featured selection. They do not consume menu-editor prices or featured flags.
- Read lunch-page dish names, prices and images from the current local catalog. Preserve both ordinary photographs and transparent cutouts in menu presentation: photo mode retains its background; cutout mode uses contain sizing. Missing or deliberately removed images need a fallback, not an unconditional replacement asset.
- Show each dish's available image and brief details directly in its card. Cards with a positive bag quantity use a deep-red added highlight, checkmark and quantity read from the actual cart. Clearing the dish from the bag clears this state. Required side, soup/pop, preparation and style selectors stay in the choose-dish modal. Missing images retain a graceful fallback without fabricated dish substitutions.

The earlier proposal to drive the homepage from featured lunch dishes is superseded. The lunch menu and local editor remain separate from the editorial story section. Menu changes do not rewrite homepage stories or create a daily discount.

## Local editing and launch boundary

`/staff/menu/` lets local restaurant managers publish lunch prices, details, availability, images and choice groups to PostgreSQL. New dishes can be published with zero choice groups. For dishes without choices, **Add** puts one serving straight into the bag. Dish photos and the bag’s **Edit** action still open details and kitchen notes.

Managers can archive or restore dishes. Archived dishes stay in the staff editor and are unavailable on the storefront and in new quotes. A menu reset preserves archived dishes and their saved settings. Previously accepted orders keep their original prices and selections. Generated food imagery is illustrative.

Imported lunch rows retain `fixture: true` for live-ordering eligibility. The local preview accepts unpaid delivery requests. Production menu operating details, taxes, reservations, payments and printer qualification require separate acceptance.

The 28-test domain/lunch/promotion/catalog suite passed after the import, including all 37 items/category counts, required options and upgrade arithmetic, source terms, explicit markers, live-pricing rejection, local overrides and legacy compatibility. These results do not establish browser layout or production launch acceptance.
