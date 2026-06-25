# F.A.R.T. — Flesh and Blood Playline Sandbox

A single-player "goldfishing" sandbox for Flesh and Blood. Paste a Fabrary deck
list, draw an opening hand sized to your hero's intellect, and play out turns
by yourself — drawing, pitching (to the bottom of the deck, in the order you
choose), arsenaling, and discarding — to study your playlines.

**Fully static.** No backend, no accounts. Open `index.html` in a browser, or
visit the deployed page. Card images and data are fetched at runtime by card
name from the official [CardVault API](https://cardvault.fabtcg.com); when a
card can't be matched it falls back to a clean placeholder.

## Files
- `index.html` — page shell
- `styles.css` — design system + layouts (desktop + mobile)
- `app.js` — parser, game state, zones, actions, card-art resolver
