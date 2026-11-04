// Every in-app product, in one place, keyed by a platform-neutral ID.
//
// `store` holds the product ID used in each store's console. Leave a platform
// null until the product exists there; it is simply not offered on that
// platform. All products here are non-consumable (bought once, restored on
// reinstall from the player's store account).
//
// To add a product: add it here, create it in Play Console (and later App Store
// Connect) with the same ID, then reference it from cosmetics.js if it is a skin.

export const PRODUCTS = {
  remove_ads: {
    store: { android: 'remove_ads', ios: null },
  },

  // Unlocks every cosmetic below, including ones added later.
  cosmetics_bundle: {
    store: { android: 'cosmetics_bundle', ios: null },
  },

  skin_starship_stainless: { store: { android: 'skin_starship_stainless', ios: null } },
  skin_starship_gold: { store: { android: 'skin_starship_gold', ios: null } },
  skin_starship_mars: { store: { android: 'skin_starship_mars', ios: null } },
  skin_booster_gold: { store: { android: 'skin_booster_gold', ios: null } },
  skin_booster_midnight: { store: { android: 'skin_booster_midnight', ios: null } },
  skin_starlink_gold: { store: { android: 'skin_starlink_gold', ios: null } },
  skin_starlink_neon: { store: { android: 'skin_starlink_neon', ios: null } },
};

export const REMOVE_ADS = 'remove_ads';
export const COSMETICS_BUNDLE = 'cosmetics_bundle';
