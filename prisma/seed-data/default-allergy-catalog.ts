/** Auto-generated allergy catalogue — at least 100 entries per category. */
export type AllergyCatalogCategory = 'FOOD' | 'DRINK' | 'ENVIRONMENTAL' | 'MEDICATION' | 'OTHER';

export type AllergyCatalogSeedEntry = {
  name: string;
  code: string;
  category: AllergyCatalogCategory;
};

export const ALLERGY_CATALOG_CATEGORY_ORDER: AllergyCatalogCategory[] = [
  'FOOD',
  'DRINK',
  'ENVIRONMENTAL',
  'MEDICATION',
  'OTHER',
];

export const ALLERGY_CATALOG_CATEGORY_LABELS: Record<AllergyCatalogCategory, string> = {
  FOOD: 'Food',
  DRINK: 'Drink',
  ENVIRONMENTAL: 'Environmental & contact',
  MEDICATION: 'Medication',
  OTHER: 'Other',
};

export const DEFAULT_ALLERGY_CATALOG = [
  {
    "name": "Peanuts",
    "code": "FOOD_PEANUTS",
    "category": "FOOD"
  },
  {
    "name": "Tree nuts (general)",
    "code": "FOOD_TREE_NUTS_GENERAL",
    "category": "FOOD"
  },
  {
    "name": "Almonds",
    "code": "FOOD_ALMONDS",
    "category": "FOOD"
  },
  {
    "name": "Cashews",
    "code": "FOOD_CASHEWS",
    "category": "FOOD"
  },
  {
    "name": "Walnuts",
    "code": "FOOD_WALNUTS",
    "category": "FOOD"
  },
  {
    "name": "Hazelnuts",
    "code": "FOOD_HAZELNUTS",
    "category": "FOOD"
  },
  {
    "name": "Pistachios",
    "code": "FOOD_PISTACHIOS",
    "category": "FOOD"
  },
  {
    "name": "Brazil nuts",
    "code": "FOOD_BRAZIL_NUTS",
    "category": "FOOD"
  },
  {
    "name": "Pecans",
    "code": "FOOD_PECANS",
    "category": "FOOD"
  },
  {
    "name": "Macadamia nuts",
    "code": "FOOD_MACADAMIA_NUTS",
    "category": "FOOD"
  },
  {
    "name": "Pine nuts",
    "code": "FOOD_PINE_NUTS",
    "category": "FOOD"
  },
  {
    "name": "Chestnuts",
    "code": "FOOD_CHESTNUTS",
    "category": "FOOD"
  },
  {
    "name": "Milk / dairy",
    "code": "FOOD_MILK_DAIRY",
    "category": "FOOD"
  },
  {
    "name": "Cheese",
    "code": "FOOD_CHEESE",
    "category": "FOOD"
  },
  {
    "name": "Yogurt",
    "code": "FOOD_YOGURT",
    "category": "FOOD"
  },
  {
    "name": "Whey",
    "code": "FOOD_WHEY",
    "category": "FOOD"
  },
  {
    "name": "Casein",
    "code": "FOOD_CASEIN",
    "category": "FOOD"
  },
  {
    "name": "Lactose",
    "code": "FOOD_LACTOSE",
    "category": "FOOD"
  },
  {
    "name": "Eggs",
    "code": "FOOD_EGGS",
    "category": "FOOD"
  },
  {
    "name": "Egg white",
    "code": "FOOD_EGG_WHITE",
    "category": "FOOD"
  },
  {
    "name": "Egg yolk",
    "code": "FOOD_EGG_YOLK",
    "category": "FOOD"
  },
  {
    "name": "Wheat",
    "code": "FOOD_WHEAT",
    "category": "FOOD"
  },
  {
    "name": "Gluten",
    "code": "FOOD_GLUTEN",
    "category": "FOOD"
  },
  {
    "name": "Barley",
    "code": "FOOD_BARLEY",
    "category": "FOOD"
  },
  {
    "name": "Rye",
    "code": "FOOD_RYE",
    "category": "FOOD"
  },
  {
    "name": "Oats",
    "code": "FOOD_OATS",
    "category": "FOOD"
  },
  {
    "name": "Spelt",
    "code": "FOOD_SPELT",
    "category": "FOOD"
  },
  {
    "name": "Kamut",
    "code": "FOOD_KAMUT",
    "category": "FOOD"
  },
  {
    "name": "Soy",
    "code": "FOOD_SOY",
    "category": "FOOD"
  },
  {
    "name": "Soy sauce",
    "code": "FOOD_SOY_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Tofu",
    "code": "FOOD_TOFU",
    "category": "FOOD"
  },
  {
    "name": "Tempeh",
    "code": "FOOD_TEMPEH",
    "category": "FOOD"
  },
  {
    "name": "Fish (general)",
    "code": "FOOD_FISH_GENERAL",
    "category": "FOOD"
  },
  {
    "name": "Salmon",
    "code": "FOOD_SALMON",
    "category": "FOOD"
  },
  {
    "name": "Tuna",
    "code": "FOOD_TUNA",
    "category": "FOOD"
  },
  {
    "name": "Cod",
    "code": "FOOD_COD",
    "category": "FOOD"
  },
  {
    "name": "Haddock",
    "code": "FOOD_HADDOCK",
    "category": "FOOD"
  },
  {
    "name": "Mackerel",
    "code": "FOOD_MACKEREL",
    "category": "FOOD"
  },
  {
    "name": "Sardines",
    "code": "FOOD_SARDINES",
    "category": "FOOD"
  },
  {
    "name": "Anchovies",
    "code": "FOOD_ANCHOVIES",
    "category": "FOOD"
  },
  {
    "name": "Trout",
    "code": "FOOD_TROUT",
    "category": "FOOD"
  },
  {
    "name": "Halibut",
    "code": "FOOD_HALIBUT",
    "category": "FOOD"
  },
  {
    "name": "Shellfish (general)",
    "code": "FOOD_SHELLFISH_GENERAL",
    "category": "FOOD"
  },
  {
    "name": "Prawns / shrimp",
    "code": "FOOD_PRAWNS_SHRIMP",
    "category": "FOOD"
  },
  {
    "name": "Crab",
    "code": "FOOD_CRAB",
    "category": "FOOD"
  },
  {
    "name": "Lobster",
    "code": "FOOD_LOBSTER",
    "category": "FOOD"
  },
  {
    "name": "Mussels",
    "code": "FOOD_MUSSELS",
    "category": "FOOD"
  },
  {
    "name": "Oysters",
    "code": "FOOD_OYSTERS",
    "category": "FOOD"
  },
  {
    "name": "Scallops",
    "code": "FOOD_SCALLOPS",
    "category": "FOOD"
  },
  {
    "name": "Clams",
    "code": "FOOD_CLAMS",
    "category": "FOOD"
  },
  {
    "name": "Squid",
    "code": "FOOD_SQUID",
    "category": "FOOD"
  },
  {
    "name": "Octopus",
    "code": "FOOD_OCTOPUS",
    "category": "FOOD"
  },
  {
    "name": "Crayfish",
    "code": "FOOD_CRAYFISH",
    "category": "FOOD"
  },
  {
    "name": "Sesame",
    "code": "FOOD_SESAME",
    "category": "FOOD"
  },
  {
    "name": "Tahini",
    "code": "FOOD_TAHINI",
    "category": "FOOD"
  },
  {
    "name": "Celery",
    "code": "FOOD_CELERY",
    "category": "FOOD"
  },
  {
    "name": "Celeriac",
    "code": "FOOD_CELERIAC",
    "category": "FOOD"
  },
  {
    "name": "Mustard",
    "code": "FOOD_MUSTARD",
    "category": "FOOD"
  },
  {
    "name": "Lupin",
    "code": "FOOD_LUPIN",
    "category": "FOOD"
  },
  {
    "name": "Sulphites (food preservative)",
    "code": "FOOD_SULPHITES_FOOD_PRESERVATIVE",
    "category": "FOOD"
  },
  {
    "name": "Kiwi fruit",
    "code": "FOOD_KIWI_FRUIT",
    "category": "FOOD"
  },
  {
    "name": "Banana",
    "code": "FOOD_BANANA",
    "category": "FOOD"
  },
  {
    "name": "Avocado",
    "code": "FOOD_AVOCADO",
    "category": "FOOD"
  },
  {
    "name": "Peach",
    "code": "FOOD_PEACH",
    "category": "FOOD"
  },
  {
    "name": "Nectarine",
    "code": "FOOD_NECTARINE",
    "category": "FOOD"
  },
  {
    "name": "Plum",
    "code": "FOOD_PLUM",
    "category": "FOOD"
  },
  {
    "name": "Apricot",
    "code": "FOOD_APRICOT",
    "category": "FOOD"
  },
  {
    "name": "Cherry",
    "code": "FOOD_CHERRY",
    "category": "FOOD"
  },
  {
    "name": "Apple",
    "code": "FOOD_APPLE",
    "category": "FOOD"
  },
  {
    "name": "Pear",
    "code": "FOOD_PEAR",
    "category": "FOOD"
  },
  {
    "name": "Strawberry",
    "code": "FOOD_STRAWBERRY",
    "category": "FOOD"
  },
  {
    "name": "Raspberry",
    "code": "FOOD_RASPBERRY",
    "category": "FOOD"
  },
  {
    "name": "Blueberry",
    "code": "FOOD_BLUEBERRY",
    "category": "FOOD"
  },
  {
    "name": "Blackberry",
    "code": "FOOD_BLACKBERRY",
    "category": "FOOD"
  },
  {
    "name": "Cranberry",
    "code": "FOOD_CRANBERRY",
    "category": "FOOD"
  },
  {
    "name": "Grape",
    "code": "FOOD_GRAPE",
    "category": "FOOD"
  },
  {
    "name": "Melon",
    "code": "FOOD_MELON",
    "category": "FOOD"
  },
  {
    "name": "Watermelon",
    "code": "FOOD_WATERMELON",
    "category": "FOOD"
  },
  {
    "name": "Mango",
    "code": "FOOD_MANGO",
    "category": "FOOD"
  },
  {
    "name": "Papaya",
    "code": "FOOD_PAPAYA",
    "category": "FOOD"
  },
  {
    "name": "Pineapple",
    "code": "FOOD_PINEAPPLE",
    "category": "FOOD"
  },
  {
    "name": "Coconut",
    "code": "FOOD_COCONUT",
    "category": "FOOD"
  },
  {
    "name": "Passion fruit",
    "code": "FOOD_PASSION_FRUIT",
    "category": "FOOD"
  },
  {
    "name": "Pomegranate",
    "code": "FOOD_POMEGRANATE",
    "category": "FOOD"
  },
  {
    "name": "Fig",
    "code": "FOOD_FIG",
    "category": "FOOD"
  },
  {
    "name": "Date",
    "code": "FOOD_DATE",
    "category": "FOOD"
  },
  {
    "name": "Tomato",
    "code": "FOOD_TOMATO",
    "category": "FOOD"
  },
  {
    "name": "Potato",
    "code": "FOOD_POTATO",
    "category": "FOOD"
  },
  {
    "name": "Sweet potato",
    "code": "FOOD_SWEET_POTATO",
    "category": "FOOD"
  },
  {
    "name": "Carrot",
    "code": "FOOD_CARROT",
    "category": "FOOD"
  },
  {
    "name": "Parsnip",
    "code": "FOOD_PARSNIP",
    "category": "FOOD"
  },
  {
    "name": "Turnip",
    "code": "FOOD_TURNIP",
    "category": "FOOD"
  },
  {
    "name": "Beetroot",
    "code": "FOOD_BEETROOT",
    "category": "FOOD"
  },
  {
    "name": "Broccoli",
    "code": "FOOD_BROCCOLI",
    "category": "FOOD"
  },
  {
    "name": "Cauliflower",
    "code": "FOOD_CAULIFLOWER",
    "category": "FOOD"
  },
  {
    "name": "Cabbage",
    "code": "FOOD_CABBAGE",
    "category": "FOOD"
  },
  {
    "name": "Brussels sprouts",
    "code": "FOOD_BRUSSELS_SPROUTS",
    "category": "FOOD"
  },
  {
    "name": "Kale",
    "code": "FOOD_KALE",
    "category": "FOOD"
  },
  {
    "name": "Spinach",
    "code": "FOOD_SPINACH",
    "category": "FOOD"
  },
  {
    "name": "Lettuce",
    "code": "FOOD_LETTUCE",
    "category": "FOOD"
  },
  {
    "name": "Cucumber",
    "code": "FOOD_CUCUMBER",
    "category": "FOOD"
  },
  {
    "name": "Zucchini",
    "code": "FOOD_ZUCCHINI",
    "category": "FOOD"
  },
  {
    "name": "Aubergine / eggplant",
    "code": "FOOD_AUBERGINE_EGGPLANT",
    "category": "FOOD"
  },
  {
    "name": "Bell pepper",
    "code": "FOOD_BELL_PEPPER",
    "category": "FOOD"
  },
  {
    "name": "Chilli pepper",
    "code": "FOOD_CHILLI_PEPPER",
    "category": "FOOD"
  },
  {
    "name": "Mushroom",
    "code": "FOOD_MUSHROOM",
    "category": "FOOD"
  },
  {
    "name": "Asparagus",
    "code": "FOOD_ASPARAGUS",
    "category": "FOOD"
  },
  {
    "name": "Garlic",
    "code": "FOOD_GARLIC",
    "category": "FOOD"
  },
  {
    "name": "Onion",
    "code": "FOOD_ONION",
    "category": "FOOD"
  },
  {
    "name": "Leek",
    "code": "FOOD_LEEK",
    "category": "FOOD"
  },
  {
    "name": "Spring onion",
    "code": "FOOD_SPRING_ONION",
    "category": "FOOD"
  },
  {
    "name": "Corn / maize",
    "code": "FOOD_CORN_MAIZE",
    "category": "FOOD"
  },
  {
    "name": "Rice",
    "code": "FOOD_RICE",
    "category": "FOOD"
  },
  {
    "name": "Quinoa",
    "code": "FOOD_QUINOA",
    "category": "FOOD"
  },
  {
    "name": "Chocolate / cocoa",
    "code": "FOOD_CHOCOLATE_COCOA",
    "category": "FOOD"
  },
  {
    "name": "Yeast",
    "code": "FOOD_YEAST",
    "category": "FOOD"
  },
  {
    "name": "Beef",
    "code": "FOOD_BEEF",
    "category": "FOOD"
  },
  {
    "name": "Pork",
    "code": "FOOD_PORK",
    "category": "FOOD"
  },
  {
    "name": "Chicken",
    "code": "FOOD_CHICKEN",
    "category": "FOOD"
  },
  {
    "name": "Turkey",
    "code": "FOOD_TURKEY",
    "category": "FOOD"
  },
  {
    "name": "Duck",
    "code": "FOOD_DUCK",
    "category": "FOOD"
  },
  {
    "name": "Lamb",
    "code": "FOOD_LAMB",
    "category": "FOOD"
  },
  {
    "name": "Venison",
    "code": "FOOD_VENISON",
    "category": "FOOD"
  },
  {
    "name": "Gelatin",
    "code": "FOOD_GELATIN",
    "category": "FOOD"
  },
  {
    "name": "Kidney beans",
    "code": "FOOD_KIDNEY_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Black beans",
    "code": "FOOD_BLACK_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Chickpeas",
    "code": "FOOD_CHICKPEAS",
    "category": "FOOD"
  },
  {
    "name": "Lentils",
    "code": "FOOD_LENTILS",
    "category": "FOOD"
  },
  {
    "name": "Green peas",
    "code": "FOOD_GREEN_PEAS",
    "category": "FOOD"
  },
  {
    "name": "Peanut butter",
    "code": "FOOD_PEANUT_BUTTER",
    "category": "FOOD"
  },
  {
    "name": "Honey",
    "code": "FOOD_HONEY",
    "category": "FOOD"
  },
  {
    "name": "Cinnamon",
    "code": "FOOD_CINNAMON",
    "category": "FOOD"
  },
  {
    "name": "Cumin",
    "code": "FOOD_CUMIN",
    "category": "FOOD"
  },
  {
    "name": "Turmeric",
    "code": "FOOD_TURMERIC",
    "category": "FOOD"
  },
  {
    "name": "Ginger",
    "code": "FOOD_GINGER",
    "category": "FOOD"
  },
  {
    "name": "Paprika",
    "code": "FOOD_PAPRIKA",
    "category": "FOOD"
  },
  {
    "name": "Nutmeg",
    "code": "FOOD_NUTMEG",
    "category": "FOOD"
  },
  {
    "name": "MSG",
    "code": "FOOD_MSG",
    "category": "FOOD"
  },
  {
    "name": "Food colourings",
    "code": "FOOD_FOOD_COLOURINGS",
    "category": "FOOD"
  },
  {
    "name": "Nitrates (processed meat)",
    "code": "FOOD_NITRATES_PROCESSED_MEAT",
    "category": "FOOD"
  },
  {
    "name": "Benzoates",
    "code": "FOOD_BENZOATES",
    "category": "FOOD"
  },
  {
    "name": "Sunflower seeds",
    "code": "FOOD_SUNFLOWER_SEEDS",
    "category": "FOOD"
  },
  {
    "name": "Pumpkin seeds",
    "code": "FOOD_PUMPKIN_SEEDS",
    "category": "FOOD"
  },
  {
    "name": "Poppy seeds",
    "code": "FOOD_POPPY_SEEDS",
    "category": "FOOD"
  },
  {
    "name": "Flax seeds",
    "code": "FOOD_FLAX_SEEDS",
    "category": "FOOD"
  },
  {
    "name": "Chia seeds",
    "code": "FOOD_CHIA_SEEDS",
    "category": "FOOD"
  },
  {
    "name": "Artichoke",
    "code": "FOOD_ARTICHOKE",
    "category": "FOOD"
  },
  {
    "name": "Okra",
    "code": "FOOD_OKRA",
    "category": "FOOD"
  },
  {
    "name": "Radish",
    "code": "FOOD_RADISH",
    "category": "FOOD"
  },
  {
    "name": "Swede",
    "code": "FOOD_SWEDE",
    "category": "FOOD"
  },
  {
    "name": "Fennel",
    "code": "FOOD_FENNEL",
    "category": "FOOD"
  },
  {
    "name": "Buckwheat",
    "code": "FOOD_BUCKWHEAT",
    "category": "FOOD"
  },
  {
    "name": "Millet",
    "code": "FOOD_MILLET",
    "category": "FOOD"
  },
  {
    "name": "Tapioca",
    "code": "FOOD_TAPIOCA",
    "category": "FOOD"
  },
  {
    "name": "Cassava",
    "code": "FOOD_CASSAVA",
    "category": "FOOD"
  },
  {
    "name": "Plantain",
    "code": "FOOD_PLANTAIN",
    "category": "FOOD"
  },
  {
    "name": "Lychee",
    "code": "FOOD_LYCHEE",
    "category": "FOOD"
  },
  {
    "name": "Dragon fruit",
    "code": "FOOD_DRAGON_FRUIT",
    "category": "FOOD"
  },
  {
    "name": "Guava",
    "code": "FOOD_GUAVA",
    "category": "FOOD"
  },
  {
    "name": "Grapefruit",
    "code": "FOOD_GRAPEFRUIT",
    "category": "FOOD"
  },
  {
    "name": "Lemon",
    "code": "FOOD_LEMON",
    "category": "FOOD"
  },
  {
    "name": "Lime",
    "code": "FOOD_LIME",
    "category": "FOOD"
  },
  {
    "name": "Orange",
    "code": "FOOD_ORANGE",
    "category": "FOOD"
  },
  {
    "name": "Tangerine",
    "code": "FOOD_TANGERINE",
    "category": "FOOD"
  },
  {
    "name": "Clementine",
    "code": "FOOD_CLEMENTINE",
    "category": "FOOD"
  },
  {
    "name": "Persimmon",
    "code": "FOOD_PERSIMMON",
    "category": "FOOD"
  },
  {
    "name": "Star fruit",
    "code": "FOOD_STAR_FRUIT",
    "category": "FOOD"
  },
  {
    "name": "Jackfruit",
    "code": "FOOD_JACKFRUIT",
    "category": "FOOD"
  },
  {
    "name": "Durian",
    "code": "FOOD_DURIAN",
    "category": "FOOD"
  },
  {
    "name": "Mulberry",
    "code": "FOOD_MULBERRY",
    "category": "FOOD"
  },
  {
    "name": "Gooseberry",
    "code": "FOOD_GOOSEBERRY",
    "category": "FOOD"
  },
  {
    "name": "Elderberry",
    "code": "FOOD_ELDERBERRY",
    "category": "FOOD"
  },
  {
    "name": "Rhubarb",
    "code": "FOOD_RHUBARB",
    "category": "FOOD"
  },
  {
    "name": "Watercress",
    "code": "FOOD_WATERCRESS",
    "category": "FOOD"
  },
  {
    "name": "Rocket / arugula",
    "code": "FOOD_ROCKET_ARUGULA",
    "category": "FOOD"
  },
  {
    "name": "Endive",
    "code": "FOOD_ENDIVE",
    "category": "FOOD"
  },
  {
    "name": "Chicory",
    "code": "FOOD_CHICORY",
    "category": "FOOD"
  },
  {
    "name": "Swiss chard",
    "code": "FOOD_SWISS_CHARD",
    "category": "FOOD"
  },
  {
    "name": "Bok choy",
    "code": "FOOD_BOK_CHOY",
    "category": "FOOD"
  },
  {
    "name": "Bean sprouts",
    "code": "FOOD_BEAN_SPROUTS",
    "category": "FOOD"
  },
  {
    "name": "Bamboo shoots",
    "code": "FOOD_BAMBOO_SHOOTS",
    "category": "FOOD"
  },
  {
    "name": "Seaweed / nori",
    "code": "FOOD_SEAWEED_NORI",
    "category": "FOOD"
  },
  {
    "name": "Wakame",
    "code": "FOOD_WAKAME",
    "category": "FOOD"
  },
  {
    "name": "Kelp",
    "code": "FOOD_KELP",
    "category": "FOOD"
  },
  {
    "name": "Fish roe",
    "code": "FOOD_FISH_ROE",
    "category": "FOOD"
  },
  {
    "name": "Caviar",
    "code": "FOOD_CAVIAR",
    "category": "FOOD"
  },
  {
    "name": "Snails / escargot",
    "code": "FOOD_SNAILS_ESCARGOT",
    "category": "FOOD"
  },
  {
    "name": "Tripe",
    "code": "FOOD_TRIPE",
    "category": "FOOD"
  },
  {
    "name": "Liver",
    "code": "FOOD_LIVER",
    "category": "FOOD"
  },
  {
    "name": "Kidney",
    "code": "FOOD_KIDNEY",
    "category": "FOOD"
  },
  {
    "name": "Heart (offal)",
    "code": "FOOD_HEART_OFFAL",
    "category": "FOOD"
  },
  {
    "name": "Bone marrow",
    "code": "FOOD_BONE_MARROW",
    "category": "FOOD"
  },
  {
    "name": "Carrageenan",
    "code": "FOOD_CARRAGEENAN",
    "category": "FOOD"
  },
  {
    "name": "Xanthan gum",
    "code": "FOOD_XANTHAN_GUM",
    "category": "FOOD"
  },
  {
    "name": "Guar gum",
    "code": "FOOD_GUAR_GUM",
    "category": "FOOD"
  },
  {
    "name": "Pectin",
    "code": "FOOD_PECTIN",
    "category": "FOOD"
  },
  {
    "name": "Ghee",
    "code": "FOOD_GHEE",
    "category": "FOOD"
  },
  {
    "name": "Buttermilk",
    "code": "FOOD_BUTTERMILK",
    "category": "FOOD"
  },
  {
    "name": "Cream",
    "code": "FOOD_CREAM",
    "category": "FOOD"
  },
  {
    "name": "Ice cream",
    "code": "FOOD_ICE_CREAM",
    "category": "FOOD"
  },
  {
    "name": "Mayonnaise",
    "code": "FOOD_MAYONNAISE",
    "category": "FOOD"
  },
  {
    "name": "Horseradish",
    "code": "FOOD_HORSERADISH",
    "category": "FOOD"
  },
  {
    "name": "Wasabi",
    "code": "FOOD_WASABI",
    "category": "FOOD"
  },
  {
    "name": "Vinegar",
    "code": "FOOD_VINEGAR",
    "category": "FOOD"
  },
  {
    "name": "Balsamic vinegar",
    "code": "FOOD_BALSAMIC_VINEGAR",
    "category": "FOOD"
  },
  {
    "name": "Pickles",
    "code": "FOOD_PICKLES",
    "category": "FOOD"
  },
  {
    "name": "Olives",
    "code": "FOOD_OLIVES",
    "category": "FOOD"
  },
  {
    "name": "Capers",
    "code": "FOOD_CAPERS",
    "category": "FOOD"
  },
  {
    "name": "Sauerkraut",
    "code": "FOOD_SAUERKRAUT",
    "category": "FOOD"
  },
  {
    "name": "Kimchi",
    "code": "FOOD_KIMCHI",
    "category": "FOOD"
  },
  {
    "name": "Miso",
    "code": "FOOD_MISO",
    "category": "FOOD"
  },
  {
    "name": "Natto",
    "code": "FOOD_NATTO",
    "category": "FOOD"
  },
  {
    "name": "Edamame",
    "code": "FOOD_EDAMAME",
    "category": "FOOD"
  },
  {
    "name": "Broad beans",
    "code": "FOOD_BROAD_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Haricot beans",
    "code": "FOOD_HARICOT_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Pinto beans",
    "code": "FOOD_PINTO_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Cannellini beans",
    "code": "FOOD_CANNELLINI_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Butter beans",
    "code": "FOOD_BUTTER_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Soya lecithin",
    "code": "FOOD_SOYA_LECITHIN",
    "category": "FOOD"
  },
  {
    "name": "Coconut milk (food)",
    "code": "FOOD_COCONUT_MILK_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Semolina",
    "code": "FOOD_SEMOLINA",
    "category": "FOOD"
  },
  {
    "name": "Polenta",
    "code": "FOOD_POLENTA",
    "category": "FOOD"
  },
  {
    "name": "Couscous",
    "code": "FOOD_COUSCOUS",
    "category": "FOOD"
  },
  {
    "name": "Bulgur wheat",
    "code": "FOOD_BULGUR_WHEAT",
    "category": "FOOD"
  },
  {
    "name": "Pasta",
    "code": "FOOD_PASTA",
    "category": "FOOD"
  },
  {
    "name": "Noodles",
    "code": "FOOD_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Bread",
    "code": "FOOD_BREAD",
    "category": "FOOD"
  },
  {
    "name": "Pastry",
    "code": "FOOD_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Cereal",
    "code": "FOOD_CEREAL",
    "category": "FOOD"
  },
  {
    "name": "Granola",
    "code": "FOOD_GRANOLA",
    "category": "FOOD"
  },
  {
    "name": "Dried fruit (general)",
    "code": "FOOD_DRIED_FRUIT_GENERAL",
    "category": "FOOD"
  },
  {
    "name": "Raisins",
    "code": "FOOD_RAISINS",
    "category": "FOOD"
  },
  {
    "name": "Sultanas",
    "code": "FOOD_SULTANAS",
    "category": "FOOD"
  },
  {
    "name": "Prunes",
    "code": "FOOD_PRUNES",
    "category": "FOOD"
  },
  {
    "name": "Dried apricots",
    "code": "FOOD_DRIED_APRICOTS",
    "category": "FOOD"
  },
  {
    "name": "Trail mix",
    "code": "FOOD_TRAIL_MIX",
    "category": "FOOD"
  },
  {
    "name": "Jam / preserves",
    "code": "FOOD_JAM_PRESERVES",
    "category": "FOOD"
  },
  {
    "name": "Peanut oil",
    "code": "FOOD_PEANUT_OIL",
    "category": "FOOD"
  },
  {
    "name": "Sesame oil",
    "code": "FOOD_SESAME_OIL",
    "category": "FOOD"
  },
  {
    "name": "Sunflower oil",
    "code": "FOOD_SUNFLOWER_OIL",
    "category": "FOOD"
  },
  {
    "name": "Olive oil",
    "code": "FOOD_OLIVE_OIL",
    "category": "FOOD"
  },
  {
    "name": "Coconut oil",
    "code": "FOOD_COCONUT_OIL",
    "category": "FOOD"
  },
  {
    "name": "Palm oil",
    "code": "FOOD_PALM_OIL",
    "category": "FOOD"
  },
  {
    "name": "Rapeseed / canola oil",
    "code": "FOOD_RAPESEED_CANOLA_OIL",
    "category": "FOOD"
  },
  {
    "name": "Artificial food flavouring",
    "code": "FOOD_ARTIFICIAL_FOOD_FLAVOURING",
    "category": "FOOD"
  },
  {
    "name": "Baker's yeast",
    "code": "FOOD_BAKER_S_YEAST",
    "category": "FOOD"
  },
  {
    "name": "Nutmeg mace",
    "code": "FOOD_NUTMEG_MACE",
    "category": "FOOD"
  },
  {
    "name": "Cardamom",
    "code": "FOOD_CARDAMOM",
    "category": "FOOD"
  },
  {
    "name": "Cloves",
    "code": "FOOD_CLOVES",
    "category": "FOOD"
  },
  {
    "name": "Star anise",
    "code": "FOOD_STAR_ANISE",
    "category": "FOOD"
  },
  {
    "name": "Saffron",
    "code": "FOOD_SAFFRON",
    "category": "FOOD"
  },
  {
    "name": "Bay leaf",
    "code": "FOOD_BAY_LEAF",
    "category": "FOOD"
  },
  {
    "name": "Oregano",
    "code": "FOOD_OREGANO",
    "category": "FOOD"
  },
  {
    "name": "Basil",
    "code": "FOOD_BASIL",
    "category": "FOOD"
  },
  {
    "name": "Thyme",
    "code": "FOOD_THYME",
    "category": "FOOD"
  },
  {
    "name": "Rosemary",
    "code": "FOOD_ROSEMARY",
    "category": "FOOD"
  },
  {
    "name": "Sage",
    "code": "FOOD_SAGE",
    "category": "FOOD"
  },
  {
    "name": "Dill",
    "code": "FOOD_DILL",
    "category": "FOOD"
  },
  {
    "name": "Parsley",
    "code": "FOOD_PARSLEY",
    "category": "FOOD"
  },
  {
    "name": "Coriander leaf",
    "code": "FOOD_CORIANDER_LEAF",
    "category": "FOOD"
  },
  {
    "name": "Mint",
    "code": "FOOD_MINT",
    "category": "FOOD"
  },
  {
    "name": "Chives",
    "code": "FOOD_CHIVES",
    "category": "FOOD"
  },
  {
    "name": "Tarragon",
    "code": "FOOD_TARRAGON",
    "category": "FOOD"
  },
  {
    "name": "Marjoram",
    "code": "FOOD_MARJORAM",
    "category": "FOOD"
  },
  {
    "name": "Sumac",
    "code": "FOOD_SUMAC",
    "category": "FOOD"
  },
  {
    "name": "Allspice",
    "code": "FOOD_ALLSPICE",
    "category": "FOOD"
  },
  {
    "name": "Caraway",
    "code": "FOOD_CARAWAY",
    "category": "FOOD"
  },
  {
    "name": "Fenugreek",
    "code": "FOOD_FENUGREEK",
    "category": "FOOD"
  },
  {
    "name": "Mustard seed",
    "code": "FOOD_MUSTARD_SEED",
    "category": "FOOD"
  },
  {
    "name": "Poppy seed paste",
    "code": "FOOD_POPPY_SEED_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Tahini halva",
    "code": "FOOD_TAHINI_HALVA",
    "category": "FOOD"
  },
  {
    "name": "Halva",
    "code": "FOOD_HALVA",
    "category": "FOOD"
  },
  {
    "name": "Turkish delight",
    "code": "FOOD_TURKISH_DELIGHT",
    "category": "FOOD"
  },
  {
    "name": "Licorice",
    "code": "FOOD_LICORICE",
    "category": "FOOD"
  },
  {
    "name": "Marshmallow (gelatin)",
    "code": "FOOD_MARSHMALLOW_GELATIN",
    "category": "FOOD"
  },
  {
    "name": "Jelly sweets",
    "code": "FOOD_JELLY_SWEETS",
    "category": "FOOD"
  },
  {
    "name": "Gummy sweets",
    "code": "FOOD_GUMMY_SWEETS",
    "category": "FOOD"
  },
  {
    "name": "Chewing gum base",
    "code": "FOOD_CHEWING_GUM_BASE",
    "category": "FOOD"
  },
  {
    "name": "Food starch",
    "code": "FOOD_FOOD_STARCH",
    "category": "FOOD"
  },
  {
    "name": "Modified starch",
    "code": "FOOD_MODIFIED_STARCH",
    "category": "FOOD"
  },
  {
    "name": "Malt extract",
    "code": "FOOD_MALT_EXTRACT",
    "category": "FOOD"
  },
  {
    "name": "Barley malt",
    "code": "FOOD_BARLEY_MALT",
    "category": "FOOD"
  },
  {
    "name": "Hops",
    "code": "FOOD_HOPS",
    "category": "FOOD"
  },
  {
    "name": "Brewer's yeast",
    "code": "FOOD_BREWER_S_YEAST",
    "category": "FOOD"
  },
  {
    "name": "Wine vinegar",
    "code": "FOOD_WINE_VINEGAR",
    "category": "FOOD"
  },
  {
    "name": "Rice vinegar",
    "code": "FOOD_RICE_VINEGAR",
    "category": "FOOD"
  },
  {
    "name": "Apple cider vinegar (food)",
    "code": "FOOD_APPLE_CIDER_VINEGAR_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Tamarind",
    "code": "FOOD_TAMARIND",
    "category": "FOOD"
  },
  {
    "name": "Coconut cream",
    "code": "FOOD_COCONUT_CREAM",
    "category": "FOOD"
  },
  {
    "name": "Condensed milk",
    "code": "FOOD_CONDENSED_MILK",
    "category": "FOOD"
  },
  {
    "name": "Evaporated milk (food)",
    "code": "FOOD_EVAPORATED_MILK_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Custard powder",
    "code": "FOOD_CUSTARD_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Angel cake",
    "code": "FOOD_ANGEL_CAKE",
    "category": "FOOD"
  },
  {
    "name": "Meringue",
    "code": "FOOD_MERINGUE",
    "category": "FOOD"
  },
  {
    "name": "Royal icing",
    "code": "FOOD_ROYAL_ICING",
    "category": "FOOD"
  },
  {
    "name": "Marzipan",
    "code": "FOOD_MARZIPAN",
    "category": "FOOD"
  },
  {
    "name": "Almond paste",
    "code": "FOOD_ALMOND_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Praline",
    "code": "FOOD_PRALINE",
    "category": "FOOD"
  },
  {
    "name": "Nougat",
    "code": "FOOD_NOUGAT",
    "category": "FOOD"
  },
  {
    "name": "Toffee",
    "code": "FOOD_TOFFEE",
    "category": "FOOD"
  },
  {
    "name": "Fudge",
    "code": "FOOD_FUDGE",
    "category": "FOOD"
  },
  {
    "name": "Caramel",
    "code": "FOOD_CARAMEL",
    "category": "FOOD"
  },
  {
    "name": "Butterscotch",
    "code": "FOOD_BUTTERSCOTCH",
    "category": "FOOD"
  },
  {
    "name": "Popcorn",
    "code": "FOOD_POPCORN",
    "category": "FOOD"
  },
  {
    "name": "Pretzels",
    "code": "FOOD_PRETZELS",
    "category": "FOOD"
  },
  {
    "name": "Crackers",
    "code": "FOOD_CRACKERS",
    "category": "FOOD"
  },
  {
    "name": "Rice cakes",
    "code": "FOOD_RICE_CAKES",
    "category": "FOOD"
  },
  {
    "name": "Cornflakes",
    "code": "FOOD_CORNFLAKES",
    "category": "FOOD"
  },
  {
    "name": "Weetabix-style cereal",
    "code": "FOOD_WEETABIX_STYLE_CEREAL",
    "category": "FOOD"
  },
  {
    "name": "Porridge oats",
    "code": "FOOD_PORRIDGE_OATS",
    "category": "FOOD"
  },
  {
    "name": "Overnight oats",
    "code": "FOOD_OVERNIGHT_OATS",
    "category": "FOOD"
  },
  {
    "name": "Sourdough starter",
    "code": "FOOD_SOURDOUGH_STARTER",
    "category": "FOOD"
  },
  {
    "name": "Yeast extract spread",
    "code": "FOOD_YEAST_EXTRACT_SPREAD",
    "category": "FOOD"
  },
  {
    "name": "Stock cubes",
    "code": "FOOD_STOCK_CUBES",
    "category": "FOOD"
  },
  {
    "name": "Gravy granules",
    "code": "FOOD_GRAVY_GRANULES",
    "category": "FOOD"
  },
  {
    "name": "Soy milk powder",
    "code": "FOOD_SOY_MILK_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Whey protein powder",
    "code": "FOOD_WHEY_PROTEIN_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Casein protein powder",
    "code": "FOOD_CASEIN_PROTEIN_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Egg powder",
    "code": "FOOD_EGG_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Albumin",
    "code": "FOOD_ALBUMIN",
    "category": "FOOD"
  },
  {
    "name": "Isinglass",
    "code": "FOOD_ISINGLASS",
    "category": "FOOD"
  },
  {
    "name": "Beef stock",
    "code": "FOOD_BEEF_STOCK",
    "category": "FOOD"
  },
  {
    "name": "Chicken stock",
    "code": "FOOD_CHICKEN_STOCK",
    "category": "FOOD"
  },
  {
    "name": "Fish sauce",
    "code": "FOOD_FISH_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Oyster sauce",
    "code": "FOOD_OYSTER_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Worcestershire sauce",
    "code": "FOOD_WORCESTERSHIRE_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Hoisin sauce",
    "code": "FOOD_HOISIN_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Teriyaki sauce",
    "code": "FOOD_TERIYAKI_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Barbecue sauce",
    "code": "FOOD_BARBECUE_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Ketchup",
    "code": "FOOD_KETCHUP",
    "category": "FOOD"
  },
  {
    "name": "Brown sauce",
    "code": "FOOD_BROWN_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Salad cream",
    "code": "FOOD_SALAD_CREAM",
    "category": "FOOD"
  },
  {
    "name": "Coleslaw dressing",
    "code": "FOOD_COLESLAW_DRESSING",
    "category": "FOOD"
  },
  {
    "name": "Caesar dressing",
    "code": "FOOD_CAESAR_DRESSING",
    "category": "FOOD"
  },
  {
    "name": "Thousand island dressing",
    "code": "FOOD_THOUSAND_ISLAND_DRESSING",
    "category": "FOOD"
  },
  {
    "name": "Ranch dressing",
    "code": "FOOD_RANCH_DRESSING",
    "category": "FOOD"
  },
  {
    "name": "Vinaigrette",
    "code": "FOOD_VINAIGRETTE",
    "category": "FOOD"
  },
  {
    "name": "Tartare sauce",
    "code": "FOOD_TARTARE_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Aioli",
    "code": "FOOD_AIOLI",
    "category": "FOOD"
  },
  {
    "name": "Hummus",
    "code": "FOOD_HUMMUS",
    "category": "FOOD"
  },
  {
    "name": "Baba ganoush",
    "code": "FOOD_BABA_GANOUSH",
    "category": "FOOD"
  },
  {
    "name": "Tzatziki",
    "code": "FOOD_TZATZIKI",
    "category": "FOOD"
  },
  {
    "name": "Raita",
    "code": "FOOD_RAITA",
    "category": "FOOD"
  },
  {
    "name": "Guacamole",
    "code": "FOOD_GUACAMOLE",
    "category": "FOOD"
  },
  {
    "name": "Salsa",
    "code": "FOOD_SALSA",
    "category": "FOOD"
  },
  {
    "name": "Pesto",
    "code": "FOOD_PESTO",
    "category": "FOOD"
  },
  {
    "name": "Tapenade",
    "code": "FOOD_TAPENADE",
    "category": "FOOD"
  },
  {
    "name": "Anchovy paste",
    "code": "FOOD_ANCHOVY_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Shrimp paste",
    "code": "FOOD_SHRIMP_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Fish paste",
    "code": "FOOD_FISH_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Surimi",
    "code": "FOOD_SURIMI",
    "category": "FOOD"
  },
  {
    "name": "Imitation crab",
    "code": "FOOD_IMITATION_CRAB",
    "category": "FOOD"
  },
  {
    "name": "Spam / luncheon meat",
    "code": "FOOD_SPAM_LUNCHEON_MEAT",
    "category": "FOOD"
  },
  {
    "name": "Black pudding",
    "code": "FOOD_BLACK_PUDDING",
    "category": "FOOD"
  },
  {
    "name": "White pudding",
    "code": "FOOD_WHITE_PUDDING",
    "category": "FOOD"
  },
  {
    "name": "Haggis",
    "code": "FOOD_HAGGIS",
    "category": "FOOD"
  },
  {
    "name": "Salami",
    "code": "FOOD_SALAMI",
    "category": "FOOD"
  },
  {
    "name": "Chorizo",
    "code": "FOOD_CHORIZO",
    "category": "FOOD"
  },
  {
    "name": "Pepperoni",
    "code": "FOOD_PEPPERONI",
    "category": "FOOD"
  },
  {
    "name": "Prosciutto",
    "code": "FOOD_PROSCIUTTO",
    "category": "FOOD"
  },
  {
    "name": "Parma ham",
    "code": "FOOD_PARMA_HAM",
    "category": "FOOD"
  },
  {
    "name": "Bacon",
    "code": "FOOD_BACON",
    "category": "FOOD"
  },
  {
    "name": "Gammon",
    "code": "FOOD_GAMMON",
    "category": "FOOD"
  },
  {
    "name": "Sausages",
    "code": "FOOD_SAUSAGES",
    "category": "FOOD"
  },
  {
    "name": "Black beans sauce",
    "code": "FOOD_BLACK_BEANS_SAUCE",
    "category": "FOOD"
  },
  {
    "name": "Refried beans",
    "code": "FOOD_REFRIED_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Baked beans",
    "code": "FOOD_BAKED_BEANS",
    "category": "FOOD"
  },
  {
    "name": "Cannellini mash",
    "code": "FOOD_CANNELLINI_MASH",
    "category": "FOOD"
  },
  {
    "name": "Falafel",
    "code": "FOOD_FALAFEL",
    "category": "FOOD"
  },
  {
    "name": "Seitan",
    "code": "FOOD_SEITAN",
    "category": "FOOD"
  },
  {
    "name": "Textured vegetable protein",
    "code": "FOOD_TEXTURED_VEGETABLE_PROTEIN",
    "category": "FOOD"
  },
  {
    "name": "Quorn / mycoprotein",
    "code": "FOOD_QUORN_MYCOPROTEIN",
    "category": "FOOD"
  },
  {
    "name": "Nut roast",
    "code": "FOOD_NUT_ROAST",
    "category": "FOOD"
  },
  {
    "name": "Veggie burger binder",
    "code": "FOOD_VEGGIE_BURGER_BINDER",
    "category": "FOOD"
  },
  {
    "name": "Agar agar",
    "code": "FOOD_AGAR_AGAR",
    "category": "FOOD"
  },
  {
    "name": "Konjac",
    "code": "FOOD_KONJAC",
    "category": "FOOD"
  },
  {
    "name": "Shirataki noodles",
    "code": "FOOD_SHIRATAKI_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Rice paper",
    "code": "FOOD_RICE_PAPER",
    "category": "FOOD"
  },
  {
    "name": "Wonton wrappers",
    "code": "FOOD_WONTON_WRAPPERS",
    "category": "FOOD"
  },
  {
    "name": "Spring roll pastry",
    "code": "FOOD_SPRING_ROLL_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Fil pastry",
    "code": "FOOD_FIL_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Puff pastry",
    "code": "FOOD_PUFF_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Shortcrust pastry",
    "code": "FOOD_SHORTCRUST_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Choux pastry",
    "code": "FOOD_CHOUX_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Brioche",
    "code": "FOOD_BRIOCHE",
    "category": "FOOD"
  },
  {
    "name": "Croissant",
    "code": "FOOD_CROISSANT",
    "category": "FOOD"
  },
  {
    "name": "Danish pastry",
    "code": "FOOD_DANISH_PASTRY",
    "category": "FOOD"
  },
  {
    "name": "Bagel",
    "code": "FOOD_BAGEL",
    "category": "FOOD"
  },
  {
    "name": "Pitta bread",
    "code": "FOOD_PITTA_BREAD",
    "category": "FOOD"
  },
  {
    "name": "Naan bread",
    "code": "FOOD_NAAN_BREAD",
    "category": "FOOD"
  },
  {
    "name": "Chapati",
    "code": "FOOD_CHAPATI",
    "category": "FOOD"
  },
  {
    "name": "Tortilla wrap",
    "code": "FOOD_TORTILLA_WRAP",
    "category": "FOOD"
  },
  {
    "name": "Taco shell",
    "code": "FOOD_TACO_SHELL",
    "category": "FOOD"
  },
  {
    "name": "Corn tortilla",
    "code": "FOOD_CORN_TORTILLA",
    "category": "FOOD"
  },
  {
    "name": "Rice noodles",
    "code": "FOOD_RICE_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Udon noodles",
    "code": "FOOD_UDON_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Soba noodles",
    "code": "FOOD_SOBA_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Glass noodles",
    "code": "FOOD_GLASS_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Egg noodles",
    "code": "FOOD_EGG_NOODLES",
    "category": "FOOD"
  },
  {
    "name": "Instant noodles seasoning",
    "code": "FOOD_INSTANT_NOODLES_SEASONING",
    "category": "FOOD"
  },
  {
    "name": "Ramen broth",
    "code": "FOOD_RAMEN_BROTH",
    "category": "FOOD"
  },
  {
    "name": "Pho broth",
    "code": "FOOD_PHO_BROTH",
    "category": "FOOD"
  },
  {
    "name": "Miso soup",
    "code": "FOOD_MISO_SOUP",
    "category": "FOOD"
  },
  {
    "name": "Tom yum paste",
    "code": "FOOD_TOM_YUM_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Curry paste",
    "code": "FOOD_CURRY_PASTE",
    "category": "FOOD"
  },
  {
    "name": "Coconut aminos",
    "code": "FOOD_COCONUT_AMINOS",
    "category": "FOOD"
  },
  {
    "name": "Liquid smoke",
    "code": "FOOD_LIQUID_SMOKE",
    "category": "FOOD"
  },
  {
    "name": "Nutritional yeast",
    "code": "FOOD_NUTRITIONAL_YEAST",
    "category": "FOOD"
  },
  {
    "name": "Spirulina",
    "code": "FOOD_SPIRULINA",
    "category": "FOOD"
  },
  {
    "name": "Chlorella",
    "code": "FOOD_CHLORELLA",
    "category": "FOOD"
  },
  {
    "name": "Wheatgrass powder",
    "code": "FOOD_WHEATGRASS_POWDER",
    "category": "FOOD"
  },
  {
    "name": "Matcha powder (food)",
    "code": "FOOD_MATCHA_POWDER_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Cocoa butter",
    "code": "FOOD_COCOA_BUTTER",
    "category": "FOOD"
  },
  {
    "name": "Cacao nibs",
    "code": "FOOD_CACAO_NIBS",
    "category": "FOOD"
  },
  {
    "name": "White chocolate",
    "code": "FOOD_WHITE_CHOCOLATE",
    "category": "FOOD"
  },
  {
    "name": "Dark chocolate",
    "code": "FOOD_DARK_CHOCOLATE",
    "category": "FOOD"
  },
  {
    "name": "Milk chocolate",
    "code": "FOOD_MILK_CHOCOLATE",
    "category": "FOOD"
  },
  {
    "name": "Carob",
    "code": "FOOD_CAROB",
    "category": "FOOD"
  },
  {
    "name": "Inulin",
    "code": "FOOD_INULIN",
    "category": "FOOD"
  },
  {
    "name": "Fructooligosaccharides",
    "code": "FOOD_FRUCTOOLIGOSACCHARIDES",
    "category": "FOOD"
  },
  {
    "name": "Polyols / sugar alcohols",
    "code": "FOOD_POLYOLS_SUGAR_ALCOHOLS",
    "category": "FOOD"
  },
  {
    "name": "Sorbitol (food)",
    "code": "FOOD_SORBITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Mannitol (food)",
    "code": "FOOD_MANNITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Xylitol (food)",
    "code": "FOOD_XYLITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Erythritol (food)",
    "code": "FOOD_ERYTHRITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Maltitol (food)",
    "code": "FOOD_MALTITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Isomalt (food)",
    "code": "FOOD_ISOMALT_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Lactitol (food)",
    "code": "FOOD_LACTITOL_FOOD",
    "category": "FOOD"
  },
  {
    "name": "Tagatose",
    "code": "FOOD_TAGATOSE",
    "category": "FOOD"
  },
  {
    "name": "Trehalose",
    "code": "FOOD_TREHALOSE",
    "category": "FOOD"
  },
  {
    "name": "Dextrose",
    "code": "FOOD_DEXTROSE",
    "category": "FOOD"
  },
  {
    "name": "Glucose syrup",
    "code": "FOOD_GLUCOSE_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Golden syrup",
    "code": "FOOD_GOLDEN_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Molasses",
    "code": "FOOD_MOLASSES",
    "category": "FOOD"
  },
  {
    "name": "Blackstrap molasses",
    "code": "FOOD_BLACKSTRAP_MOLASSES",
    "category": "FOOD"
  },
  {
    "name": "Agave syrup",
    "code": "FOOD_AGAVE_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Rice syrup",
    "code": "FOOD_RICE_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Barley syrup",
    "code": "FOOD_BARLEY_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Date syrup",
    "code": "FOOD_DATE_SYRUP",
    "category": "FOOD"
  },
  {
    "name": "Coconut sugar",
    "code": "FOOD_COCONUT_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Palm sugar",
    "code": "FOOD_PALM_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Brown sugar",
    "code": "FOOD_BROWN_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Icing sugar",
    "code": "FOOD_ICING_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Caster sugar",
    "code": "FOOD_CASTER_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Demerara sugar",
    "code": "FOOD_DEMERARA_SUGAR",
    "category": "FOOD"
  },
  {
    "name": "Jaggery",
    "code": "FOOD_JAGGERY",
    "category": "FOOD"
  },
  {
    "name": "Panela",
    "code": "FOOD_PANELA",
    "category": "FOOD"
  },
  {
    "name": "Treacle",
    "code": "FOOD_TREACLE",
    "category": "FOOD"
  },
  {
    "name": "Pearl barley",
    "code": "FOOD_PEARL_BARLEY",
    "category": "FOOD"
  },
  {
    "name": "Farro",
    "code": "FOOD_FARRO",
    "category": "FOOD"
  },
  {
    "name": "Freekeh",
    "code": "FOOD_FREEKEH",
    "category": "FOOD"
  },
  {
    "name": "Amaranth",
    "code": "FOOD_AMARANTH",
    "category": "FOOD"
  },
  {
    "name": "Teff",
    "code": "FOOD_TEFF",
    "category": "FOOD"
  },
  {
    "name": "Sorghum",
    "code": "FOOD_SORGHUM",
    "category": "FOOD"
  },
  {
    "name": "Job's tears",
    "code": "FOOD_JOB_S_TEARS",
    "category": "FOOD"
  },
  {
    "name": "Wild rice",
    "code": "FOOD_WILD_RICE",
    "category": "FOOD"
  },
  {
    "name": "Red rice",
    "code": "FOOD_RED_RICE",
    "category": "FOOD"
  },
  {
    "name": "Black rice",
    "code": "FOOD_BLACK_RICE",
    "category": "FOOD"
  },
  {
    "name": "Sticky rice",
    "code": "FOOD_STICKY_RICE",
    "category": "FOOD"
  },
  {
    "name": "Arborio rice",
    "code": "FOOD_ARBORIO_RICE",
    "category": "FOOD"
  },
  {
    "name": "Basmati rice",
    "code": "FOOD_BASMATI_RICE",
    "category": "FOOD"
  },
  {
    "name": "Jasmine rice",
    "code": "FOOD_JASMINE_RICE",
    "category": "FOOD"
  },
  {
    "name": "Sushi rice seasoning",
    "code": "FOOD_SUSHI_RICE_SEASONING",
    "category": "FOOD"
  },
  {
    "name": "Paella seasoning",
    "code": "FOOD_PAELLA_SEASONING",
    "category": "FOOD"
  },
  {
    "name": "Risotto stock",
    "code": "FOOD_RISOTTO_STOCK",
    "category": "FOOD"
  },
  {
    "name": "Alcohol (general)",
    "code": "DRINK_ALCOHOL_GENERAL",
    "category": "DRINK"
  },
  {
    "name": "Beer",
    "code": "DRINK_BEER",
    "category": "DRINK"
  },
  {
    "name": "Lager",
    "code": "DRINK_LAGER",
    "category": "DRINK"
  },
  {
    "name": "Ale",
    "code": "DRINK_ALE",
    "category": "DRINK"
  },
  {
    "name": "Stout",
    "code": "DRINK_STOUT",
    "category": "DRINK"
  },
  {
    "name": "Cider",
    "code": "DRINK_CIDER",
    "category": "DRINK"
  },
  {
    "name": "Wine (red)",
    "code": "DRINK_WINE_RED",
    "category": "DRINK"
  },
  {
    "name": "Wine (white)",
    "code": "DRINK_WINE_WHITE",
    "category": "DRINK"
  },
  {
    "name": "Rosé wine",
    "code": "DRINK_ROS_WINE",
    "category": "DRINK"
  },
  {
    "name": "Champagne",
    "code": "DRINK_CHAMPAGNE",
    "category": "DRINK"
  },
  {
    "name": "Prosecco",
    "code": "DRINK_PROSECCO",
    "category": "DRINK"
  },
  {
    "name": "Port",
    "code": "DRINK_PORT",
    "category": "DRINK"
  },
  {
    "name": "Sherry",
    "code": "DRINK_SHERRY",
    "category": "DRINK"
  },
  {
    "name": "Brandy",
    "code": "DRINK_BRANDY",
    "category": "DRINK"
  },
  {
    "name": "Whisky",
    "code": "DRINK_WHISKY",
    "category": "DRINK"
  },
  {
    "name": "Vodka",
    "code": "DRINK_VODKA",
    "category": "DRINK"
  },
  {
    "name": "Gin",
    "code": "DRINK_GIN",
    "category": "DRINK"
  },
  {
    "name": "Rum",
    "code": "DRINK_RUM",
    "category": "DRINK"
  },
  {
    "name": "Tequila",
    "code": "DRINK_TEQUILA",
    "category": "DRINK"
  },
  {
    "name": "Liqueurs",
    "code": "DRINK_LIQUEURS",
    "category": "DRINK"
  },
  {
    "name": "Coffee",
    "code": "DRINK_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Espresso",
    "code": "DRINK_ESPRESSO",
    "category": "DRINK"
  },
  {
    "name": "Cappuccino",
    "code": "DRINK_CAPPUCCINO",
    "category": "DRINK"
  },
  {
    "name": "Decaffeinated coffee",
    "code": "DRINK_DECAFFEINATED_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Instant coffee",
    "code": "DRINK_INSTANT_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Tea (black)",
    "code": "DRINK_TEA_BLACK",
    "category": "DRINK"
  },
  {
    "name": "Green tea",
    "code": "DRINK_GREEN_TEA",
    "category": "DRINK"
  },
  {
    "name": "Herbal tea",
    "code": "DRINK_HERBAL_TEA",
    "category": "DRINK"
  },
  {
    "name": "Chamomile tea",
    "code": "DRINK_CHAMOMILE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Peppermint tea",
    "code": "DRINK_PEPPERMINT_TEA",
    "category": "DRINK"
  },
  {
    "name": "Rooibos tea",
    "code": "DRINK_ROOIBOS_TEA",
    "category": "DRINK"
  },
  {
    "name": "Matcha",
    "code": "DRINK_MATCHA",
    "category": "DRINK"
  },
  {
    "name": "Coffee with milk",
    "code": "DRINK_COFFEE_WITH_MILK",
    "category": "DRINK"
  },
  {
    "name": "Iced coffee",
    "code": "DRINK_ICED_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Tea with milk",
    "code": "DRINK_TEA_WITH_MILK",
    "category": "DRINK"
  },
  {
    "name": "Citrus juice",
    "code": "DRINK_CITRUS_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Orange juice",
    "code": "DRINK_ORANGE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Apple juice",
    "code": "DRINK_APPLE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Grape juice",
    "code": "DRINK_GRAPE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Tomato juice",
    "code": "DRINK_TOMATO_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Cranberry juice",
    "code": "DRINK_CRANBERRY_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Pineapple juice",
    "code": "DRINK_PINEAPPLE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Mango juice",
    "code": "DRINK_MANGO_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Energy drinks",
    "code": "DRINK_ENERGY_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Cola / fizzy drinks",
    "code": "DRINK_COLA_FIZZY_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Lemonade",
    "code": "DRINK_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Ginger ale",
    "code": "DRINK_GINGER_ALE",
    "category": "DRINK"
  },
  {
    "name": "Tonic water",
    "code": "DRINK_TONIC_WATER",
    "category": "DRINK"
  },
  {
    "name": "Sparkling water",
    "code": "DRINK_SPARKLING_WATER",
    "category": "DRINK"
  },
  {
    "name": "Flavoured water",
    "code": "DRINK_FLAVOURED_WATER",
    "category": "DRINK"
  },
  {
    "name": "Sports drinks",
    "code": "DRINK_SPORTS_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Artificial sweeteners (in drinks)",
    "code": "DRINK_ARTIFICIAL_SWEETENERS_IN_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Milk (cow)",
    "code": "DRINK_MILK_COW",
    "category": "DRINK"
  },
  {
    "name": "Goat milk",
    "code": "DRINK_GOAT_MILK",
    "category": "DRINK"
  },
  {
    "name": "Sheep milk",
    "code": "DRINK_SHEEP_MILK",
    "category": "DRINK"
  },
  {
    "name": "Almond milk",
    "code": "DRINK_ALMOND_MILK",
    "category": "DRINK"
  },
  {
    "name": "Oat milk",
    "code": "DRINK_OAT_MILK",
    "category": "DRINK"
  },
  {
    "name": "Soy milk",
    "code": "DRINK_SOY_MILK",
    "category": "DRINK"
  },
  {
    "name": "Rice milk",
    "code": "DRINK_RICE_MILK",
    "category": "DRINK"
  },
  {
    "name": "Coconut milk (drink)",
    "code": "DRINK_COCONUT_MILK_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Hazelnut milk",
    "code": "DRINK_HAZELNUT_MILK",
    "category": "DRINK"
  },
  {
    "name": "Cashew milk",
    "code": "DRINK_CASHEW_MILK",
    "category": "DRINK"
  },
  {
    "name": "Protein shakes",
    "code": "DRINK_PROTEIN_SHAKES",
    "category": "DRINK"
  },
  {
    "name": "Meal replacement shakes",
    "code": "DRINK_MEAL_REPLACEMENT_SHAKES",
    "category": "DRINK"
  },
  {
    "name": "Kombucha",
    "code": "DRINK_KOMBUCHA",
    "category": "DRINK"
  },
  {
    "name": "Kefir",
    "code": "DRINK_KEFIR",
    "category": "DRINK"
  },
  {
    "name": "Yoghurt drinks",
    "code": "DRINK_YOGHURT_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Smoothies",
    "code": "DRINK_SMOOTHIES",
    "category": "DRINK"
  },
  {
    "name": "Milkshakes",
    "code": "DRINK_MILKSHAKES",
    "category": "DRINK"
  },
  {
    "name": "Hot chocolate",
    "code": "DRINK_HOT_CHOCOLATE",
    "category": "DRINK"
  },
  {
    "name": "Cocoa drink",
    "code": "DRINK_COCOA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Bubble tea",
    "code": "DRINK_BUBBLE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Iced tea",
    "code": "DRINK_ICED_TEA",
    "category": "DRINK"
  },
  {
    "name": "Chai latte",
    "code": "DRINK_CHAI_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Golden milk",
    "code": "DRINK_GOLDEN_MILK",
    "category": "DRINK"
  },
  {
    "name": "Electrolyte drinks",
    "code": "DRINK_ELECTROLYTE_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Vitamin water",
    "code": "DRINK_VITAMIN_WATER",
    "category": "DRINK"
  },
  {
    "name": "Coconut water",
    "code": "DRINK_COCONUT_WATER",
    "category": "DRINK"
  },
  {
    "name": "Aloe vera drink",
    "code": "DRINK_ALOE_VERA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Wheatgrass juice",
    "code": "DRINK_WHEATGRASS_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Beetroot juice",
    "code": "DRINK_BEETROOT_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Carrot juice",
    "code": "DRINK_CARROT_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Celery juice",
    "code": "DRINK_CELERY_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Pomegranate juice",
    "code": "DRINK_POMEGRANATE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Grapefruit juice",
    "code": "DRINK_GRAPEFRUIT_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Lime cordial",
    "code": "DRINK_LIME_CORDIAL",
    "category": "DRINK"
  },
  {
    "name": "Fruit squash / cordial",
    "code": "DRINK_FRUIT_SQUASH_CORDIAL",
    "category": "DRINK"
  },
  {
    "name": "Ginger beer",
    "code": "DRINK_GINGER_BEER",
    "category": "DRINK"
  },
  {
    "name": "Root beer",
    "code": "DRINK_ROOT_BEER",
    "category": "DRINK"
  },
  {
    "name": "Cream soda",
    "code": "DRINK_CREAM_SODA",
    "category": "DRINK"
  },
  {
    "name": "Dandelion coffee",
    "code": "DRINK_DANDELION_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Barley water",
    "code": "DRINK_BARLEY_WATER",
    "category": "DRINK"
  },
  {
    "name": "Rice drink",
    "code": "DRINK_RICE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Pea milk",
    "code": "DRINK_PEA_MILK",
    "category": "DRINK"
  },
  {
    "name": "Hemp milk",
    "code": "DRINK_HEMP_MILK",
    "category": "DRINK"
  },
  {
    "name": "Flax milk",
    "code": "DRINK_FLAX_MILK",
    "category": "DRINK"
  },
  {
    "name": "Macadamia milk",
    "code": "DRINK_MACADAMIA_MILK",
    "category": "DRINK"
  },
  {
    "name": "Condensed milk (drink)",
    "code": "DRINK_CONDENSED_MILK_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Lactose-free milk",
    "code": "DRINK_LACTOSE_FREE_MILK",
    "category": "DRINK"
  },
  {
    "name": "UHT milk",
    "code": "DRINK_UHT_MILK",
    "category": "DRINK"
  },
  {
    "name": "Skimmed milk",
    "code": "DRINK_SKIMMED_MILK",
    "category": "DRINK"
  },
  {
    "name": "Whole milk",
    "code": "DRINK_WHOLE_MILK",
    "category": "DRINK"
  },
  {
    "name": "Semi-skimmed milk",
    "code": "DRINK_SEMI_SKIMMED_MILK",
    "category": "DRINK"
  },
  {
    "name": "Eggnog",
    "code": "DRINK_EGGNOG",
    "category": "DRINK"
  },
  {
    "name": "Mulled wine",
    "code": "DRINK_MULLED_WINE",
    "category": "DRINK"
  },
  {
    "name": "Sangria",
    "code": "DRINK_SANGRIA",
    "category": "DRINK"
  },
  {
    "name": "Mimosa",
    "code": "DRINK_MIMOSA",
    "category": "DRINK"
  },
  {
    "name": "Sake",
    "code": "DRINK_SAKE",
    "category": "DRINK"
  },
  {
    "name": "Soju",
    "code": "DRINK_SOJU",
    "category": "DRINK"
  },
  {
    "name": "Absinthe",
    "code": "DRINK_ABSINTHE",
    "category": "DRINK"
  },
  {
    "name": "Vermouth",
    "code": "DRINK_VERMOUTH",
    "category": "DRINK"
  },
  {
    "name": "Bitters",
    "code": "DRINK_BITTERS",
    "category": "DRINK"
  },
  {
    "name": "Coffee liqueur",
    "code": "DRINK_COFFEE_LIQUEUR",
    "category": "DRINK"
  },
  {
    "name": "Baileys / cream liqueur",
    "code": "DRINK_BAILEYS_CREAM_LIQUEUR",
    "category": "DRINK"
  },
  {
    "name": "Non-alcoholic beer",
    "code": "DRINK_NON_ALCOHOLIC_BEER",
    "category": "DRINK"
  },
  {
    "name": "Non-alcoholic wine",
    "code": "DRINK_NON_ALCOHOLIC_WINE",
    "category": "DRINK"
  },
  {
    "name": "Prebiotic soda",
    "code": "DRINK_PREBIOTIC_SODA",
    "category": "DRINK"
  },
  {
    "name": "Cold brew coffee",
    "code": "DRINK_COLD_BREW_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Nitro coffee",
    "code": "DRINK_NITRO_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Frappé",
    "code": "DRINK_FRAPP",
    "category": "DRINK"
  },
  {
    "name": "Chicory coffee substitute",
    "code": "DRINK_CHICORY_COFFEE_SUBSTITUTE",
    "category": "DRINK"
  },
  {
    "name": "Malt drink",
    "code": "DRINK_MALT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Horlicks",
    "code": "DRINK_HORLICKS",
    "category": "DRINK"
  },
  {
    "name": "Ovaltine",
    "code": "DRINK_OVALTINE",
    "category": "DRINK"
  },
  {
    "name": "Lucozade",
    "code": "DRINK_LUCOZADE",
    "category": "DRINK"
  },
  {
    "name": "Red Bull",
    "code": "DRINK_RED_BULL",
    "category": "DRINK"
  },
  {
    "name": "Monster energy",
    "code": "DRINK_MONSTER_ENERGY",
    "category": "DRINK"
  },
  {
    "name": "Sugar-free cola",
    "code": "DRINK_SUGAR_FREE_COLA",
    "category": "DRINK"
  },
  {
    "name": "Diet drinks (aspartame)",
    "code": "DRINK_DIET_DRINKS_ASPARTAME",
    "category": "DRINK"
  },
  {
    "name": "Stevia-sweetened drinks",
    "code": "DRINK_STEVIA_SWEETENED_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Sucralose in beverages",
    "code": "DRINK_SUCRALOSE_IN_BEVERAGES",
    "category": "DRINK"
  },
  {
    "name": "Saccharin in beverages",
    "code": "DRINK_SACCHARIN_IN_BEVERAGES",
    "category": "DRINK"
  },
  {
    "name": "Tannins (red wine)",
    "code": "DRINK_TANNINS_RED_WINE",
    "category": "DRINK"
  },
  {
    "name": "Histamine (wine)",
    "code": "DRINK_HISTAMINE_WINE",
    "category": "DRINK"
  },
  {
    "name": "Sulphites (wine)",
    "code": "DRINK_SULPHITES_WINE",
    "category": "DRINK"
  },
  {
    "name": "Tyramine (aged drinks)",
    "code": "DRINK_TYRAMINE_AGED_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Salicylates (fruit juice)",
    "code": "DRINK_SALICYLATES_FRUIT_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Benzoates (soft drinks)",
    "code": "DRINK_BENZOATES_SOFT_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Caffeine (general)",
    "code": "DRINK_CAFFEINE_GENERAL",
    "category": "DRINK"
  },
  {
    "name": "Theobromine (hot chocolate)",
    "code": "DRINK_THEOBROMINE_HOT_CHOCOLATE",
    "category": "DRINK"
  },
  {
    "name": "Quinine (tonic)",
    "code": "DRINK_QUININE_TONIC",
    "category": "DRINK"
  },
  {
    "name": "Rosehip tea",
    "code": "DRINK_ROSEHIP_TEA",
    "category": "DRINK"
  },
  {
    "name": "Hibiscus tea",
    "code": "DRINK_HIBISCUS_TEA",
    "category": "DRINK"
  },
  {
    "name": "Lemon balm tea",
    "code": "DRINK_LEMON_BALM_TEA",
    "category": "DRINK"
  },
  {
    "name": "Nettle tea",
    "code": "DRINK_NETTLE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Liquorice tea",
    "code": "DRINK_LIQUORICE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Fennel tea",
    "code": "DRINK_FENNEL_TEA",
    "category": "DRINK"
  },
  {
    "name": "Dandelion tea",
    "code": "DRINK_DANDELION_TEA",
    "category": "DRINK"
  },
  {
    "name": "Elderflower cordial",
    "code": "DRINK_ELDERFLOWER_CORDIAL",
    "category": "DRINK"
  },
  {
    "name": "Ginger shot",
    "code": "DRINK_GINGER_SHOT",
    "category": "DRINK"
  },
  {
    "name": "Turmeric shot",
    "code": "DRINK_TURMERIC_SHOT",
    "category": "DRINK"
  },
  {
    "name": "Wheatgrass shot",
    "code": "DRINK_WHEATGRASS_SHOT",
    "category": "DRINK"
  },
  {
    "name": "Probiotic drink",
    "code": "DRINK_PROBIOTIC_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Yakult",
    "code": "DRINK_YAKULT",
    "category": "DRINK"
  },
  {
    "name": "Actimel",
    "code": "DRINK_ACTIMEL",
    "category": "DRINK"
  },
  {
    "name": "Flavoured milk",
    "code": "DRINK_FLAVOURED_MILK",
    "category": "DRINK"
  },
  {
    "name": "Banana milk",
    "code": "DRINK_BANANA_MILK",
    "category": "DRINK"
  },
  {
    "name": "Strawberry milk",
    "code": "DRINK_STRAWBERRY_MILK",
    "category": "DRINK"
  },
  {
    "name": "Chocolate milk",
    "code": "DRINK_CHOCOLATE_MILK",
    "category": "DRINK"
  },
  {
    "name": "Latte",
    "code": "DRINK_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Flat white",
    "code": "DRINK_FLAT_WHITE",
    "category": "DRINK"
  },
  {
    "name": "Americano",
    "code": "DRINK_AMERICANO",
    "category": "DRINK"
  },
  {
    "name": "Macchiato",
    "code": "DRINK_MACCHIATO",
    "category": "DRINK"
  },
  {
    "name": "Mocha",
    "code": "DRINK_MOCHA",
    "category": "DRINK"
  },
  {
    "name": "Affogato",
    "code": "DRINK_AFFOGATO",
    "category": "DRINK"
  },
  {
    "name": "Irish coffee",
    "code": "DRINK_IRISH_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Espresso martini",
    "code": "DRINK_ESPRESSO_MARTINI",
    "category": "DRINK"
  },
  {
    "name": "Irish cream coffee",
    "code": "DRINK_IRISH_CREAM_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Vietnamese coffee",
    "code": "DRINK_VIETNAMESE_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Turkish coffee",
    "code": "DRINK_TURKISH_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Greek frappe",
    "code": "DRINK_GREEK_FRAPPE",
    "category": "DRINK"
  },
  {
    "name": "Cold brew tea",
    "code": "DRINK_COLD_BREW_TEA",
    "category": "DRINK"
  },
  {
    "name": "Oolong tea",
    "code": "DRINK_OOLONG_TEA",
    "category": "DRINK"
  },
  {
    "name": "White tea",
    "code": "DRINK_WHITE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Pu-erh tea",
    "code": "DRINK_PU_ERH_TEA",
    "category": "DRINK"
  },
  {
    "name": "Jasmine tea",
    "code": "DRINK_JASMINE_TEA",
    "category": "DRINK"
  },
  {
    "name": "Earl Grey tea",
    "code": "DRINK_EARL_GREY_TEA",
    "category": "DRINK"
  },
  {
    "name": "English breakfast tea",
    "code": "DRINK_ENGLISH_BREAKFAST_TEA",
    "category": "DRINK"
  },
  {
    "name": "Darjeeling tea",
    "code": "DRINK_DARJEELING_TEA",
    "category": "DRINK"
  },
  {
    "name": "Assam tea",
    "code": "DRINK_ASSAM_TEA",
    "category": "DRINK"
  },
  {
    "name": "Ceylon tea",
    "code": "DRINK_CEYLON_TEA",
    "category": "DRINK"
  },
  {
    "name": "Lapsang souchong",
    "code": "DRINK_LAPSANG_SOUCHONG",
    "category": "DRINK"
  },
  {
    "name": "Yerba mate",
    "code": "DRINK_YERBA_MATE",
    "category": "DRINK"
  },
  {
    "name": "Guayusa",
    "code": "DRINK_GUAYUSA",
    "category": "DRINK"
  },
  {
    "name": "Kombucha ginger",
    "code": "DRINK_KOMBUCHA_GINGER",
    "category": "DRINK"
  },
  {
    "name": "Kombucha berry",
    "code": "DRINK_KOMBUCHA_BERRY",
    "category": "DRINK"
  },
  {
    "name": "Kombucha original",
    "code": "DRINK_KOMBUCHA_ORIGINAL",
    "category": "DRINK"
  },
  {
    "name": "Water kefir",
    "code": "DRINK_WATER_KEFIR",
    "category": "DRINK"
  },
  {
    "name": "Milk kefir drink",
    "code": "DRINK_MILK_KEFIR_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Ayran",
    "code": "DRINK_AYRAN",
    "category": "DRINK"
  },
  {
    "name": "Lassi",
    "code": "DRINK_LASSI",
    "category": "DRINK"
  },
  {
    "name": "Chaas",
    "code": "DRINK_CHAAS",
    "category": "DRINK"
  },
  {
    "name": "Buttermilk (drink)",
    "code": "DRINK_BUTTERMILK_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Rice punch",
    "code": "DRINK_RICE_PUNCH",
    "category": "DRINK"
  },
  {
    "name": "Sikhye",
    "code": "DRINK_SIKHYE",
    "category": "DRINK"
  },
  {
    "name": "Suanmeitang",
    "code": "DRINK_SUANMEITANG",
    "category": "DRINK"
  },
  {
    "name": "Barley tea",
    "code": "DRINK_BARLEY_TEA",
    "category": "DRINK"
  },
  {
    "name": "Corn tea",
    "code": "DRINK_CORN_TEA",
    "category": "DRINK"
  },
  {
    "name": "Buckwheat tea",
    "code": "DRINK_BUCKWHEAT_TEA",
    "category": "DRINK"
  },
  {
    "name": "Soba cha",
    "code": "DRINK_SOBA_CHA",
    "category": "DRINK"
  },
  {
    "name": "Mugicha",
    "code": "DRINK_MUGICHA",
    "category": "DRINK"
  },
  {
    "name": "Genmaicha",
    "code": "DRINK_GENMAICHA",
    "category": "DRINK"
  },
  {
    "name": "Hojicha",
    "code": "DRINK_HOJICHA",
    "category": "DRINK"
  },
  {
    "name": "Kukicha",
    "code": "DRINK_KUKICHA",
    "category": "DRINK"
  },
  {
    "name": "Sencha",
    "code": "DRINK_SENCHA",
    "category": "DRINK"
  },
  {
    "name": "Gyokuro",
    "code": "DRINK_GYOKURO",
    "category": "DRINK"
  },
  {
    "name": "Bancha",
    "code": "DRINK_BANCHA",
    "category": "DRINK"
  },
  {
    "name": "Kombucha green",
    "code": "DRINK_KOMBUCHA_GREEN",
    "category": "DRINK"
  },
  {
    "name": "Sparkling apple juice",
    "code": "DRINK_SPARKLING_APPLE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Sparkling grape juice",
    "code": "DRINK_SPARKLING_GRAPE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Pear juice",
    "code": "DRINK_PEAR_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Peach juice",
    "code": "DRINK_PEACH_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Apricot nectar",
    "code": "DRINK_APRICOT_NECTAR",
    "category": "DRINK"
  },
  {
    "name": "Guava juice",
    "code": "DRINK_GUAVA_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Passion fruit juice",
    "code": "DRINK_PASSION_FRUIT_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Lychee juice",
    "code": "DRINK_LYCHEE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Coconut water pulp",
    "code": "DRINK_COCONUT_WATER_PULP",
    "category": "DRINK"
  },
  {
    "name": "Tamarind drink",
    "code": "DRINK_TAMARIND_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Sugarcane juice",
    "code": "DRINK_SUGARCANE_JUICE",
    "category": "DRINK"
  },
  {
    "name": "Aguas frescas",
    "code": "DRINK_AGUAS_FRESCAS",
    "category": "DRINK"
  },
  {
    "name": "Horchata",
    "code": "DRINK_HORCHATA",
    "category": "DRINK"
  },
  {
    "name": "Chicha",
    "code": "DRINK_CHICHA",
    "category": "DRINK"
  },
  {
    "name": "Mate cocido",
    "code": "DRINK_MATE_COCIDO",
    "category": "DRINK"
  },
  {
    "name": "Pisco sour",
    "code": "DRINK_PISCO_SOUR",
    "category": "DRINK"
  },
  {
    "name": "Caipirinha",
    "code": "DRINK_CAIPIRINHA",
    "category": "DRINK"
  },
  {
    "name": "Margarita",
    "code": "DRINK_MARGARITA",
    "category": "DRINK"
  },
  {
    "name": "Mojito",
    "code": "DRINK_MOJITO",
    "category": "DRINK"
  },
  {
    "name": "Piña colada",
    "code": "DRINK_PI_A_COLADA",
    "category": "DRINK"
  },
  {
    "name": "Daiquiri",
    "code": "DRINK_DAIQUIRI",
    "category": "DRINK"
  },
  {
    "name": "Cosmopolitan",
    "code": "DRINK_COSMOPOLITAN",
    "category": "DRINK"
  },
  {
    "name": "Negroni",
    "code": "DRINK_NEGRONI",
    "category": "DRINK"
  },
  {
    "name": "Aperol spritz",
    "code": "DRINK_APEROL_SPRITZ",
    "category": "DRINK"
  },
  {
    "name": "Bellini",
    "code": "DRINK_BELLINI",
    "category": "DRINK"
  },
  {
    "name": "Martini",
    "code": "DRINK_MARTINI",
    "category": "DRINK"
  },
  {
    "name": "Gimlet",
    "code": "DRINK_GIMLET",
    "category": "DRINK"
  },
  {
    "name": "Old fashioned",
    "code": "DRINK_OLD_FASHIONED",
    "category": "DRINK"
  },
  {
    "name": "Manhattan",
    "code": "DRINK_MANHATTAN",
    "category": "DRINK"
  },
  {
    "name": "Whiskey sour",
    "code": "DRINK_WHISKEY_SOUR",
    "category": "DRINK"
  },
  {
    "name": "Bloody Mary",
    "code": "DRINK_BLOODY_MARY",
    "category": "DRINK"
  },
  {
    "name": "Michelada",
    "code": "DRINK_MICHELADA",
    "category": "DRINK"
  },
  {
    "name": "Shandy",
    "code": "DRINK_SHANDY",
    "category": "DRINK"
  },
  {
    "name": "Radler",
    "code": "DRINK_RADLER",
    "category": "DRINK"
  },
  {
    "name": "Snakebite",
    "code": "DRINK_SNAKEBITE",
    "category": "DRINK"
  },
  {
    "name": "Black velvet",
    "code": "DRINK_BLACK_VELVET",
    "category": "DRINK"
  },
  {
    "name": "Snakebite & black",
    "code": "DRINK_SNAKEBITE_BLACK",
    "category": "DRINK"
  },
  {
    "name": "Snaps",
    "code": "DRINK_SNAPS",
    "category": "DRINK"
  },
  {
    "name": "Aquavit",
    "code": "DRINK_AQUAVIT",
    "category": "DRINK"
  },
  {
    "name": "Grappa",
    "code": "DRINK_GRAPPA",
    "category": "DRINK"
  },
  {
    "name": "Arak",
    "code": "DRINK_ARAK",
    "category": "DRINK"
  },
  {
    "name": "Raki",
    "code": "DRINK_RAKI",
    "category": "DRINK"
  },
  {
    "name": "Ouzo",
    "code": "DRINK_OUZO",
    "category": "DRINK"
  },
  {
    "name": "Pastis",
    "code": "DRINK_PASTIS",
    "category": "DRINK"
  },
  {
    "name": "Pernod",
    "code": "DRINK_PERNOD",
    "category": "DRINK"
  },
  {
    "name": "Sambuca",
    "code": "DRINK_SAMBUCA",
    "category": "DRINK"
  },
  {
    "name": "Amaretto",
    "code": "DRINK_AMARETTO",
    "category": "DRINK"
  },
  {
    "name": "Frangelico",
    "code": "DRINK_FRANGELICO",
    "category": "DRINK"
  },
  {
    "name": "Kahlúa",
    "code": "DRINK_KAHL_A",
    "category": "DRINK"
  },
  {
    "name": "Tia Maria",
    "code": "DRINK_TIA_MARIA",
    "category": "DRINK"
  },
  {
    "name": "Grand Marnier",
    "code": "DRINK_GRAND_MARNIER",
    "category": "DRINK"
  },
  {
    "name": "Cointreau",
    "code": "DRINK_COINTREAU",
    "category": "DRINK"
  },
  {
    "name": "Triple sec",
    "code": "DRINK_TRIPLE_SEC",
    "category": "DRINK"
  },
  {
    "name": "Chartreuse",
    "code": "DRINK_CHARTREUSE",
    "category": "DRINK"
  },
  {
    "name": "Benedictine",
    "code": "DRINK_BENEDICTINE",
    "category": "DRINK"
  },
  {
    "name": "Drambuie",
    "code": "DRINK_DRAMBUIE",
    "category": "DRINK"
  },
  {
    "name": "Galliano",
    "code": "DRINK_GALLIANO",
    "category": "DRINK"
  },
  {
    "name": "Jägermeister",
    "code": "DRINK_J_GERMEISTER",
    "category": "DRINK"
  },
  {
    "name": "Fernet-Branca",
    "code": "DRINK_FERNET_BRANCA",
    "category": "DRINK"
  },
  {
    "name": "Campari",
    "code": "DRINK_CAMPARI",
    "category": "DRINK"
  },
  {
    "name": "Aperol",
    "code": "DRINK_APEROL",
    "category": "DRINK"
  },
  {
    "name": "Malibu",
    "code": "DRINK_MALIBU",
    "category": "DRINK"
  },
  {
    "name": "Southern Comfort",
    "code": "DRINK_SOUTHERN_COMFORT",
    "category": "DRINK"
  },
  {
    "name": "Fireball whisky",
    "code": "DRINK_FIREBALL_WHISKY",
    "category": "DRINK"
  },
  {
    "name": "Honey whisky",
    "code": "DRINK_HONEY_WHISKY",
    "category": "DRINK"
  },
  {
    "name": "Spiced rum",
    "code": "DRINK_SPICED_RUM",
    "category": "DRINK"
  },
  {
    "name": "Dark rum",
    "code": "DRINK_DARK_RUM",
    "category": "DRINK"
  },
  {
    "name": "White rum",
    "code": "DRINK_WHITE_RUM",
    "category": "DRINK"
  },
  {
    "name": "Gold rum",
    "code": "DRINK_GOLD_RUM",
    "category": "DRINK"
  },
  {
    "name": "Overproof rum",
    "code": "DRINK_OVERPROOF_RUM",
    "category": "DRINK"
  },
  {
    "name": "Cachaça",
    "code": "DRINK_CACHA_A",
    "category": "DRINK"
  },
  {
    "name": "Mezcal",
    "code": "DRINK_MEZCAL",
    "category": "DRINK"
  },
  {
    "name": "Palinka",
    "code": "DRINK_PALINKA",
    "category": "DRINK"
  },
  {
    "name": "Slivovitz",
    "code": "DRINK_SLIVOVITZ",
    "category": "DRINK"
  },
  {
    "name": "Poitín",
    "code": "DRINK_POIT_N",
    "category": "DRINK"
  },
  {
    "name": "Moonshine",
    "code": "DRINK_MOONSHINE",
    "category": "DRINK"
  },
  {
    "name": "Schnapps",
    "code": "DRINK_SCHNAPPS",
    "category": "DRINK"
  },
  {
    "name": "Peach schnapps",
    "code": "DRINK_PEACH_SCHNAPPS",
    "category": "DRINK"
  },
  {
    "name": "Peppermint schnapps",
    "code": "DRINK_PEPPERMINT_SCHNAPPS",
    "category": "DRINK"
  },
  {
    "name": "Butterscotch schnapps",
    "code": "DRINK_BUTTERSCOTCH_SCHNAPPS",
    "category": "DRINK"
  },
  {
    "name": "Cream liqueur",
    "code": "DRINK_CREAM_LIQUEUR",
    "category": "DRINK"
  },
  {
    "name": "Egg liqueur",
    "code": "DRINK_EGG_LIQUEUR",
    "category": "DRINK"
  },
  {
    "name": "Advocaat",
    "code": "DRINK_ADVOCAAT",
    "category": "DRINK"
  },
  {
    "name": "Egg flip",
    "code": "DRINK_EGG_FLIP",
    "category": "DRINK"
  },
  {
    "name": "Flip cocktail",
    "code": "DRINK_FLIP_COCKTAIL",
    "category": "DRINK"
  },
  {
    "name": "Punch bowl mix",
    "code": "DRINK_PUNCH_BOWL_MIX",
    "category": "DRINK"
  },
  {
    "name": "Sangria red",
    "code": "DRINK_SANGRIA_RED",
    "category": "DRINK"
  },
  {
    "name": "Sangria white",
    "code": "DRINK_SANGRIA_WHITE",
    "category": "DRINK"
  },
  {
    "name": "Claret cup",
    "code": "DRINK_CLARET_CUP",
    "category": "DRINK"
  },
  {
    "name": "Pimm's",
    "code": "DRINK_PIMM_S",
    "category": "DRINK"
  },
  {
    "name": "Gin and tonic",
    "code": "DRINK_GIN_AND_TONIC",
    "category": "DRINK"
  },
  {
    "name": "Vodka soda",
    "code": "DRINK_VODKA_SODA",
    "category": "DRINK"
  },
  {
    "name": "Rum and cola",
    "code": "DRINK_RUM_AND_COLA",
    "category": "DRINK"
  },
  {
    "name": "Whisky and soda",
    "code": "DRINK_WHISKY_AND_SODA",
    "category": "DRINK"
  },
  {
    "name": "Whisky and ginger",
    "code": "DRINK_WHISKY_AND_GINGER",
    "category": "DRINK"
  },
  {
    "name": "Bourbon and coke",
    "code": "DRINK_BOURBON_AND_COKE",
    "category": "DRINK"
  },
  {
    "name": "Scotch and water",
    "code": "DRINK_SCOTCH_AND_WATER",
    "category": "DRINK"
  },
  {
    "name": "Hot toddy",
    "code": "DRINK_HOT_TODDY",
    "category": "DRINK"
  },
  {
    "name": "Glühwein",
    "code": "DRINK_GL_HWEIN",
    "category": "DRINK"
  },
  {
    "name": "Feuerzangenbowle",
    "code": "DRINK_FEUERZANGENBOWLE",
    "category": "DRINK"
  },
  {
    "name": "Grog",
    "code": "DRINK_GROG",
    "category": "DRINK"
  },
  {
    "name": "Toddy rum",
    "code": "DRINK_TODDY_RUM",
    "category": "DRINK"
  },
  {
    "name": "Ponche",
    "code": "DRINK_PONCHE",
    "category": "DRINK"
  },
  {
    "name": "Coquito",
    "code": "DRINK_COQUITO",
    "category": "DRINK"
  },
  {
    "name": "Egg cream soda",
    "code": "DRINK_EGG_CREAM_SODA",
    "category": "DRINK"
  },
  {
    "name": "Italian soda",
    "code": "DRINK_ITALIAN_SODA",
    "category": "DRINK"
  },
  {
    "name": "Cream soda vanilla",
    "code": "DRINK_CREAM_SODA_VANILLA",
    "category": "DRINK"
  },
  {
    "name": "Sarsaparilla",
    "code": "DRINK_SARSAPARILLA",
    "category": "DRINK"
  },
  {
    "name": "Dandelion and burdock",
    "code": "DRINK_DANDELION_AND_BURDOCK",
    "category": "DRINK"
  },
  {
    "name": "Tizer-style citrus soda",
    "code": "DRINK_TIZER_STYLE_CITRUS_SODA",
    "category": "DRINK"
  },
  {
    "name": "Cloudy lemonade",
    "code": "DRINK_CLOUDY_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Pink lemonade",
    "code": "DRINK_PINK_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Still lemonade",
    "code": "DRINK_STILL_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Shandy lemon",
    "code": "DRINK_SHANDY_LEMON",
    "category": "DRINK"
  },
  {
    "name": "Bitter shandy",
    "code": "DRINK_BITTER_SHANDY",
    "category": "DRINK"
  },
  {
    "name": "Radler lemon",
    "code": "DRINK_RADLER_LEMON",
    "category": "DRINK"
  },
  {
    "name": "Radler grapefruit",
    "code": "DRINK_RADLER_GRAPEFRUIT",
    "category": "DRINK"
  },
  {
    "name": "Shandy grapefruit",
    "code": "DRINK_SHANDY_GRAPEFRUIT",
    "category": "DRINK"
  },
  {
    "name": "Malzbier",
    "code": "DRINK_MALZBIER",
    "category": "DRINK"
  },
  {
    "name": "Kvass",
    "code": "DRINK_KVASS",
    "category": "DRINK"
  },
  {
    "name": "Kombucha hops",
    "code": "DRINK_KOMBUCHA_HOPS",
    "category": "DRINK"
  },
  {
    "name": "Hop water",
    "code": "DRINK_HOP_WATER",
    "category": "DRINK"
  },
  {
    "name": "CBD infused drink",
    "code": "DRINK_CBD_INFUSED_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Collagen drink",
    "code": "DRINK_COLLAGEN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Beauty drink",
    "code": "DRINK_BEAUTY_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Detox tea blend",
    "code": "DRINK_DETOX_TEA_BLEND",
    "category": "DRINK"
  },
  {
    "name": "Slimming tea",
    "code": "DRINK_SLIMMING_TEA",
    "category": "DRINK"
  },
  {
    "name": "Green coffee extract drink",
    "code": "DRINK_GREEN_COFFEE_EXTRACT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Chlorophyll water",
    "code": "DRINK_CHLOROPHYLL_WATER",
    "category": "DRINK"
  },
  {
    "name": "Charcoal lemonade",
    "code": "DRINK_CHARCOAL_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Apple cider vinegar drink",
    "code": "DRINK_APPLE_CIDER_VINEGAR_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Turmeric latte",
    "code": "DRINK_TURMERIC_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Matcha latte",
    "code": "DRINK_MATCHA_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Chai spice drink",
    "code": "DRINK_CHAI_SPICE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Golden latte",
    "code": "DRINK_GOLDEN_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Beet latte",
    "code": "DRINK_BEET_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Mushroom coffee",
    "code": "DRINK_MUSHROOM_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Adaptogen drink mix",
    "code": "DRINK_ADAPTOGEN_DRINK_MIX",
    "category": "DRINK"
  },
  {
    "name": "Electrolyte powder drink",
    "code": "DRINK_ELECTROLYTE_POWDER_DRINK",
    "category": "DRINK"
  },
  {
    "name": "ORS rehydration drink",
    "code": "DRINK_ORS_REHYDRATION_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Diabetic glucogel drink",
    "code": "DRINK_DIABETIC_GLUCOGEL_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Fortisip-style supplement drink",
    "code": "DRINK_FORTISIP_STYLE_SUPPLEMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Ensure-style supplement drink",
    "code": "DRINK_ENSURE_STYLE_SUPPLEMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Build-up soup drink",
    "code": "DRINK_BUILD_UP_SOUP_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Soup drink carton",
    "code": "DRINK_SOUP_DRINK_CARTON",
    "category": "DRINK"
  },
  {
    "name": "Bone broth drink",
    "code": "DRINK_BONE_BROTH_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Collagen broth",
    "code": "DRINK_COLLAGEN_BROTH",
    "category": "DRINK"
  },
  {
    "name": "Meal in a bottle",
    "code": "DRINK_MEAL_IN_A_BOTTLE",
    "category": "DRINK"
  },
  {
    "name": "Soy latte",
    "code": "DRINK_SOY_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Oat latte",
    "code": "DRINK_OAT_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Almond latte",
    "code": "DRINK_ALMOND_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Coconut latte",
    "code": "DRINK_COCONUT_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Hazelnut latte",
    "code": "DRINK_HAZELNUT_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Vanilla latte",
    "code": "DRINK_VANILLA_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Caramel latte",
    "code": "DRINK_CARAMEL_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Pumpkin spice latte",
    "code": "DRINK_PUMPKIN_SPICE_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Seasonal syrup coffee",
    "code": "DRINK_SEASONAL_SYRUP_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Flavoured syrup pump drinks",
    "code": "DRINK_FLAVOURED_SYRUP_PUMP_DRINKS",
    "category": "DRINK"
  },
  {
    "name": "Slush puppy syrup",
    "code": "DRINK_SLUSH_PUPPY_SYRUP",
    "category": "DRINK"
  },
  {
    "name": "Slushie machine mix",
    "code": "DRINK_SLUSHIE_MACHINE_MIX",
    "category": "DRINK"
  },
  {
    "name": "Frozen margarita mix",
    "code": "DRINK_FROZEN_MARGARITA_MIX",
    "category": "DRINK"
  },
  {
    "name": "Piña colada mix",
    "code": "DRINK_PI_A_COLADA_MIX",
    "category": "DRINK"
  },
  {
    "name": "Mojito mix",
    "code": "DRINK_MOJITO_MIX",
    "category": "DRINK"
  },
  {
    "name": "Daiquiri mix",
    "code": "DRINK_DAIQUIRI_MIX",
    "category": "DRINK"
  },
  {
    "name": "Wine cooler",
    "code": "DRINK_WINE_COOLER",
    "category": "DRINK"
  },
  {
    "name": "Hard seltzer",
    "code": "DRINK_HARD_SELTZER",
    "category": "DRINK"
  },
  {
    "name": "Hard lemonade",
    "code": "DRINK_HARD_LEMONADE",
    "category": "DRINK"
  },
  {
    "name": "Hard iced tea",
    "code": "DRINK_HARD_ICED_TEA",
    "category": "DRINK"
  },
  {
    "name": "Alcopop",
    "code": "DRINK_ALCOPOP",
    "category": "DRINK"
  },
  {
    "name": "WKD-style alcopop",
    "code": "DRINK_WKD_STYLE_ALCOPOP",
    "category": "DRINK"
  },
  {
    "name": "Smirnoff ice-style drink",
    "code": "DRINK_SMIRNOFF_ICE_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Bacardi breezer-style drink",
    "code": "DRINK_BACARDI_BREEZER_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Flavoured vodka drink",
    "code": "DRINK_FLAVOURED_VODKA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Flavoured gin drink",
    "code": "DRINK_FLAVOURED_GIN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Flavoured rum drink",
    "code": "DRINK_FLAVOURED_RUM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Flavoured whisky drink",
    "code": "DRINK_FLAVOURED_WHISKY_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Spiked seltzer",
    "code": "DRINK_SPIKED_SELTZER",
    "category": "DRINK"
  },
  {
    "name": "Low alcohol beer",
    "code": "DRINK_LOW_ALCOHOL_BEER",
    "category": "DRINK"
  },
  {
    "name": "Zero alcohol spirit",
    "code": "DRINK_ZERO_ALCOHOL_SPIRIT",
    "category": "DRINK"
  },
  {
    "name": "Seedlip-style spirit",
    "code": "DRINK_SEEDLIP_STYLE_SPIRIT",
    "category": "DRINK"
  },
  {
    "name": "Mocktail mixer",
    "code": "DRINK_MOCKTAIL_MIXER",
    "category": "DRINK"
  },
  {
    "name": "Virgin mojito",
    "code": "DRINK_VIRGIN_MOJITO",
    "category": "DRINK"
  },
  {
    "name": "Virgin piña colada",
    "code": "DRINK_VIRGIN_PI_A_COLADA",
    "category": "DRINK"
  },
  {
    "name": "Virgin margarita",
    "code": "DRINK_VIRGIN_MARGARITA",
    "category": "DRINK"
  },
  {
    "name": "Shirley Temple",
    "code": "DRINK_SHIRLEY_TEMPLE",
    "category": "DRINK"
  },
  {
    "name": "Roy Rogers",
    "code": "DRINK_ROY_ROGERS",
    "category": "DRINK"
  },
  {
    "name": "Arnold Palmer",
    "code": "DRINK_ARNOLD_PALMER",
    "category": "DRINK"
  },
  {
    "name": "John Daly",
    "code": "DRINK_JOHN_DALY",
    "category": "DRINK"
  },
  {
    "name": "Italian soda cream",
    "code": "DRINK_ITALIAN_SODA_CREAM",
    "category": "DRINK"
  },
  {
    "name": "Egg cream",
    "code": "DRINK_EGG_CREAM",
    "category": "DRINK"
  },
  {
    "name": "Malted milkshake",
    "code": "DRINK_MALTED_MILKSHAKE",
    "category": "DRINK"
  },
  {
    "name": "Thick shake",
    "code": "DRINK_THICK_SHAKE",
    "category": "DRINK"
  },
  {
    "name": "Freakshake",
    "code": "DRINK_FREAKSHAKE",
    "category": "DRINK"
  },
  {
    "name": "Protein coffee",
    "code": "DRINK_PROTEIN_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Bulletproof coffee",
    "code": "DRINK_BULLETPROOF_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Butter coffee",
    "code": "DRINK_BUTTER_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Collagen coffee",
    "code": "DRINK_COLLAGEN_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Mushroom latte",
    "code": "DRINK_MUSHROOM_LATTE",
    "category": "DRINK"
  },
  {
    "name": "Reishi coffee",
    "code": "DRINK_REISHI_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Chaga tea",
    "code": "DRINK_CHAGA_TEA",
    "category": "DRINK"
  },
  {
    "name": "Lion's mane coffee",
    "code": "DRINK_LION_S_MANE_COFFEE",
    "category": "DRINK"
  },
  {
    "name": "Ashwagandha latte",
    "code": "DRINK_ASHWAGANDHA_LATTE",
    "category": "DRINK"
  },
  {
    "name": "CBD tea",
    "code": "DRINK_CBD_TEA",
    "category": "DRINK"
  },
  {
    "name": "Kava drink",
    "code": "DRINK_KAVA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Kratom tea",
    "code": "DRINK_KRATOM_TEA",
    "category": "DRINK"
  },
  {
    "name": "Yerba mate energy drink",
    "code": "DRINK_YERBA_MATE_ENERGY_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Guarana drink",
    "code": "DRINK_GUARANA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Taurine energy blend",
    "code": "DRINK_TAURINE_ENERGY_BLEND",
    "category": "DRINK"
  },
  {
    "name": "Pre-workout drink",
    "code": "DRINK_PRE_WORKOUT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "BCAA drink",
    "code": "DRINK_BCAA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Creatine drink mix",
    "code": "DRINK_CREATINE_DRINK_MIX",
    "category": "DRINK"
  },
  {
    "name": "Isotonic sports drink",
    "code": "DRINK_ISOTONIC_SPORTS_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Hypotonic sports drink",
    "code": "DRINK_HYPOTONIC_SPORTS_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Hypertonic sports drink",
    "code": "DRINK_HYPERTONIC_SPORTS_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Oral rehydration salts drink",
    "code": "DRINK_ORAL_REHYDRATION_SALTS_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Paediatric rehydration drink",
    "code": "DRINK_PAEDIATRIC_REHYDRATION_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Diabetic hypo treatment drink",
    "code": "DRINK_DIABETIC_HYPO_TREATMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Glucose gel drink",
    "code": "DRINK_GLUCOSE_GEL_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Fortified wine drink",
    "code": "DRINK_FORTIFIED_WINE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Mead",
    "code": "DRINK_MEAD",
    "category": "DRINK"
  },
  {
    "name": "Honey wine",
    "code": "DRINK_HONEY_WINE",
    "category": "DRINK"
  },
  {
    "name": "Rice wine drink",
    "code": "DRINK_RICE_WINE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Palm wine",
    "code": "DRINK_PALM_WINE",
    "category": "DRINK"
  },
  {
    "name": "Toddy palm drink",
    "code": "DRINK_TODDY_PALM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Coconut toddy",
    "code": "DRINK_COCONUT_TODDY",
    "category": "DRINK"
  },
  {
    "name": "Fermented milk drink",
    "code": "DRINK_FERMENTED_MILK_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Filmjölk",
    "code": "DRINK_FILMJ_LK",
    "category": "DRINK"
  },
  {
    "name": "Viili",
    "code": "DRINK_VIILI",
    "category": "DRINK"
  },
  {
    "name": "Matsoni",
    "code": "DRINK_MATSONI",
    "category": "DRINK"
  },
  {
    "name": "Kumis",
    "code": "DRINK_KUMIS",
    "category": "DRINK"
  },
  {
    "name": "Airag",
    "code": "DRINK_AIRAG",
    "category": "DRINK"
  },
  {
    "name": "Boza",
    "code": "DRINK_BOZA",
    "category": "DRINK"
  },
  {
    "name": "Pulque",
    "code": "DRINK_PULQUE",
    "category": "DRINK"
  },
  {
    "name": "Chicha morada drink",
    "code": "DRINK_CHICHA_MORADA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Aguardiente",
    "code": "DRINK_AGUARDIENTE",
    "category": "DRINK"
  },
  {
    "name": "Cachaça caipirinha base",
    "code": "DRINK_CACHA_A_CAIPIRINHA_BASE",
    "category": "DRINK"
  },
  {
    "name": "Pisco",
    "code": "DRINK_PISCO",
    "category": "DRINK"
  },
  {
    "name": "Singani",
    "code": "DRINK_SINGANI",
    "category": "DRINK"
  },
  {
    "name": "Rakija",
    "code": "DRINK_RAKIJA",
    "category": "DRINK"
  },
  {
    "name": "Tuica",
    "code": "DRINK_TUICA",
    "category": "DRINK"
  },
  {
    "name": "Tsipouro",
    "code": "DRINK_TSIPOURO",
    "category": "DRINK"
  },
  {
    "name": "Zivania",
    "code": "DRINK_ZIVANIA",
    "category": "DRINK"
  },
  {
    "name": "Rakia",
    "code": "DRINK_RAKIA",
    "category": "DRINK"
  },
  {
    "name": "Horilka",
    "code": "DRINK_HORILKA",
    "category": "DRINK"
  },
  {
    "name": "Samogon-style spirit",
    "code": "DRINK_SAMOGON_STYLE_SPIRIT",
    "category": "DRINK"
  },
  {
    "name": "Baijiu",
    "code": "DRINK_BAIJIU",
    "category": "DRINK"
  },
  {
    "name": "Shochu",
    "code": "DRINK_SHOCHU",
    "category": "DRINK"
  },
  {
    "name": "Awamori",
    "code": "DRINK_AWAMORI",
    "category": "DRINK"
  },
  {
    "name": "Makgeolli",
    "code": "DRINK_MAKGEOLLI",
    "category": "DRINK"
  },
  {
    "name": "Cheongju",
    "code": "DRINK_CHEONGJU",
    "category": "DRINK"
  },
  {
    "name": "Yakju",
    "code": "DRINK_YAKJU",
    "category": "DRINK"
  },
  {
    "name": "Sake warm",
    "code": "DRINK_SAKE_WARM",
    "category": "DRINK"
  },
  {
    "name": "Sake cold",
    "code": "DRINK_SAKE_COLD",
    "category": "DRINK"
  },
  {
    "name": "Nigori sake",
    "code": "DRINK_NIGORI_SAKE",
    "category": "DRINK"
  },
  {
    "name": "Sparkling sake",
    "code": "DRINK_SPARKLING_SAKE",
    "category": "DRINK"
  },
  {
    "name": "Umeshu plum wine",
    "code": "DRINK_UMESHU_PLUM_WINE",
    "category": "DRINK"
  },
  {
    "name": "Plum liqueur drink",
    "code": "DRINK_PLUM_LIQUEUR_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Sloe gin drink",
    "code": "DRINK_SLOE_GIN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Elderflower presse",
    "code": "DRINK_ELDERFLOWER_PRESSE",
    "category": "DRINK"
  },
  {
    "name": "Ginger wine",
    "code": "DRINK_GINGER_WINE",
    "category": "DRINK"
  },
  {
    "name": "Cough medicine with alcohol",
    "code": "DRINK_COUGH_MEDICINE_WITH_ALCOHOL",
    "category": "DRINK"
  },
  {
    "name": "Medicinal tonic wine",
    "code": "DRINK_MEDICINAL_TONIC_WINE",
    "category": "DRINK"
  },
  {
    "name": "Iron tonic wine",
    "code": "DRINK_IRON_TONIC_WINE",
    "category": "DRINK"
  },
  {
    "name": "Cod liver oil liquid",
    "code": "DRINK_COD_LIVER_OIL_LIQUID",
    "category": "DRINK"
  },
  {
    "name": "Fish oil liquid drink",
    "code": "DRINK_FISH_OIL_LIQUID_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Liquid multivitamin",
    "code": "DRINK_LIQUID_MULTIVITAMIN",
    "category": "DRINK"
  },
  {
    "name": "Vitamin C drink powder",
    "code": "DRINK_VITAMIN_C_DRINK_POWDER",
    "category": "DRINK"
  },
  {
    "name": "Berocca-style drink",
    "code": "DRINK_BEROCCA_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Emergen-C-style drink",
    "code": "DRINK_EMERGEN_C_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Hydration multiplier powder",
    "code": "DRINK_HYDRATION_MULTIPLIER_POWDER",
    "category": "DRINK"
  },
  {
    "name": "Coconut electrolyte mix",
    "code": "DRINK_COCONUT_ELECTROLYTE_MIX",
    "category": "DRINK"
  },
  {
    "name": "Pink salt electrolyte drink",
    "code": "DRINK_PINK_SALT_ELECTROLYTE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Magnesium drink powder",
    "code": "DRINK_MAGNESIUM_DRINK_POWDER",
    "category": "DRINK"
  },
  {
    "name": "Calm magnesium drink",
    "code": "DRINK_CALM_MAGNESIUM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Sleep tea drink",
    "code": "DRINK_SLEEP_TEA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Night time milk drink",
    "code": "DRINK_NIGHT_TIME_MILK_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Bedtime cocoa",
    "code": "DRINK_BEDTIME_COCOA",
    "category": "DRINK"
  },
  {
    "name": "Warm malted milk",
    "code": "DRINK_WARM_MALTED_MILK",
    "category": "DRINK"
  },
  {
    "name": "Horlicks bedtime",
    "code": "DRINK_HORLICKS_BEDTIME",
    "category": "DRINK"
  },
  {
    "name": "Ovaltine bedtime",
    "code": "DRINK_OVALTINE_BEDTIME",
    "category": "DRINK"
  },
  {
    "name": "Milo drink",
    "code": "DRINK_MILO_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Bournvita drink",
    "code": "DRINK_BOURNVITA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Complan drink",
    "code": "DRINK_COMPLAN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Build-up shake",
    "code": "DRINK_BUILD_UP_SHAKE",
    "category": "DRINK"
  },
  {
    "name": "Fresubin-style drink",
    "code": "DRINK_FRESUBIN_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Resource drink",
    "code": "DRINK_RESOURCE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Fortijuce-style juice supplement",
    "code": "DRINK_FORTIJUCE_STYLE_JUICE_SUPPLEMENT",
    "category": "DRINK"
  },
  {
    "name": "Juice plus-style drink",
    "code": "DRINK_JUICE_PLUS_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Meal replacement bottle chocolate",
    "code": "DRINK_MEAL_REPLACEMENT_BOTTLE_CHOCOLATE",
    "category": "DRINK"
  },
  {
    "name": "Meal replacement bottle vanilla",
    "code": "DRINK_MEAL_REPLACEMENT_BOTTLE_VANILLA",
    "category": "DRINK"
  },
  {
    "name": "Meal replacement bottle strawberry",
    "code": "DRINK_MEAL_REPLACEMENT_BOTTLE_STRAWBERRY",
    "category": "DRINK"
  },
  {
    "name": "Vegan protein shake",
    "code": "DRINK_VEGAN_PROTEIN_SHAKE",
    "category": "DRINK"
  },
  {
    "name": "Whey shake chocolate",
    "code": "DRINK_WHEY_SHAKE_CHOCOLATE",
    "category": "DRINK"
  },
  {
    "name": "Whey shake vanilla",
    "code": "DRINK_WHEY_SHAKE_VANILLA",
    "category": "DRINK"
  },
  {
    "name": "Casein night shake",
    "code": "DRINK_CASEIN_NIGHT_SHAKE",
    "category": "DRINK"
  },
  {
    "name": "Mass gainer shake",
    "code": "DRINK_MASS_GAINER_SHAKE",
    "category": "DRINK"
  },
  {
    "name": "Collagen peptide drink",
    "code": "DRINK_COLLAGEN_PEPTIDE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Beauty collagen drink",
    "code": "DRINK_BEAUTY_COLLAGEN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Skin glow drink",
    "code": "DRINK_SKIN_GLOW_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Hair supplement drink",
    "code": "DRINK_HAIR_SUPPLEMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Joint supplement drink",
    "code": "DRINK_JOINT_SUPPLEMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Turmeric joint drink",
    "code": "DRINK_TURMERIC_JOINT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Ginger anti-nausea drink",
    "code": "DRINK_GINGER_ANTI_NAUSEA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Peppermint digestive drink",
    "code": "DRINK_PEPPERMINT_DIGESTIVE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Fennel digestive drink",
    "code": "DRINK_FENNEL_DIGESTIVE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Chamomile bedtime drink",
    "code": "DRINK_CHAMOMILE_BEDTIME_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Valerian sleep drink",
    "code": "DRINK_VALERIAN_SLEEP_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Lavender sleep tea drink",
    "code": "DRINK_LAVENDER_SLEEP_TEA_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Passionflower calm drink",
    "code": "DRINK_PASSIONFLOWER_CALM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Lemon balm calm drink",
    "code": "DRINK_LEMON_BALM_CALM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Ashwagandha calm drink",
    "code": "DRINK_ASHWAGANDHA_CALM_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Rhodiola adaptogen drink",
    "code": "DRINK_RHODIOLA_ADAPTOGEN_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Ginseng energy drink",
    "code": "DRINK_GINSENG_ENERGY_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Maca smoothie booster",
    "code": "DRINK_MACA_SMOOTHIE_BOOSTER",
    "category": "DRINK"
  },
  {
    "name": "Spirulina smoothie",
    "code": "DRINK_SPIRULINA_SMOOTHIE",
    "category": "DRINK"
  },
  {
    "name": "Chlorella smoothie",
    "code": "DRINK_CHLORELLA_SMOOTHIE",
    "category": "DRINK"
  },
  {
    "name": "Wheatgrass shot drink",
    "code": "DRINK_WHEATGRASS_SHOT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Barley grass shot",
    "code": "DRINK_BARLEY_GRASS_SHOT",
    "category": "DRINK"
  },
  {
    "name": "Algae shot",
    "code": "DRINK_ALGAE_SHOT",
    "category": "DRINK"
  },
  {
    "name": "Probiotic shot drink",
    "code": "DRINK_PROBIOTIC_SHOT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Prebiotic fibre drink",
    "code": "DRINK_PREBIOTIC_FIBRE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Fibre supplement drink",
    "code": "DRINK_FIBRE_SUPPLEMENT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Psyllium drink mix",
    "code": "DRINK_PSYLLIUM_DRINK_MIX",
    "category": "DRINK"
  },
  {
    "name": "Laxative fibre drink",
    "code": "DRINK_LAXATIVE_FIBRE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Lactulose solution drink",
    "code": "DRINK_LACTULOSE_SOLUTION_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Movicol-style drink",
    "code": "DRINK_MOVICOL_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Constipation relief drink",
    "code": "DRINK_CONSTIPATION_RELIEF_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Stool softener drink",
    "code": "DRINK_STOOL_SOFTENER_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Antacid liquid drink",
    "code": "DRINK_ANTACID_LIQUID_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Gaviscon-style drink",
    "code": "DRINK_GAVISCON_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Pepto-style drink",
    "code": "DRINK_PEPTO_STYLE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Kaolin mixture drink",
    "code": "DRINK_KAOLIN_MIXTURE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Oral suspension medicine drink",
    "code": "DRINK_ORAL_SUSPENSION_MEDICINE_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Paracetamol liquid",
    "code": "DRINK_PARACETAMOL_LIQUID",
    "category": "DRINK"
  },
  {
    "name": "Ibuprofen liquid",
    "code": "DRINK_IBUPROFEN_LIQUID",
    "category": "DRINK"
  },
  {
    "name": "Antihistamine liquid",
    "code": "DRINK_ANTIHISTAMINE_LIQUID",
    "category": "DRINK"
  },
  {
    "name": "Cough syrup",
    "code": "DRINK_COUGH_SYRUP",
    "category": "DRINK"
  },
  {
    "name": "Decongestant drink",
    "code": "DRINK_DECONGESTANT_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Throat soothing drink",
    "code": "DRINK_THROAT_SOOTHING_DRINK",
    "category": "DRINK"
  },
  {
    "name": "Honey lemon drink medicinal",
    "code": "DRINK_HONEY_LEMON_DRINK_MEDICINAL",
    "category": "DRINK"
  },
  {
    "name": "Salt gargle solution (swallowed trace)",
    "code": "DRINK_SALT_GARGLE_SOLUTION_SWALLOWED_TRACE",
    "category": "DRINK"
  },
  {
    "name": "Mouthwash accidental ingestion",
    "code": "DRINK_MOUTHWASH_ACCIDENTAL_INGESTION",
    "category": "DRINK"
  },
  {
    "name": "Chlorhexidine mouthwash drink trace",
    "code": "DRINK_CHLORHEXIDINE_MOUTHWASH_DRINK_TRACE",
    "category": "DRINK"
  },
  {
    "name": "Pollen (general)",
    "code": "ENVIRONMENTAL_POLLEN_GENERAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grass pollen",
    "code": "ENVIRONMENTAL_GRASS_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tree pollen",
    "code": "ENVIRONMENTAL_TREE_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Birch pollen",
    "code": "ENVIRONMENTAL_BIRCH_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oak pollen",
    "code": "ENVIRONMENTAL_OAK_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Maple pollen",
    "code": "ENVIRONMENTAL_MAPLE_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cedar pollen",
    "code": "ENVIRONMENTAL_CEDAR_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pine pollen",
    "code": "ENVIRONMENTAL_PINE_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Willow pollen",
    "code": "ENVIRONMENTAL_WILLOW_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ash pollen",
    "code": "ENVIRONMENTAL_ASH_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Elm pollen",
    "code": "ENVIRONMENTAL_ELM_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Alder pollen",
    "code": "ENVIRONMENTAL_ALDER_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hazel pollen",
    "code": "ENVIRONMENTAL_HAZEL_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Olive pollen",
    "code": "ENVIRONMENTAL_OLIVE_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cypress pollen",
    "code": "ENVIRONMENTAL_CYPRESS_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mulberry pollen",
    "code": "ENVIRONMENTAL_MULBERRY_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ragweed pollen",
    "code": "ENVIRONMENTAL_RAGWEED_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mugwort pollen",
    "code": "ENVIRONMENTAL_MUGWORT_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Plantain pollen",
    "code": "ENVIRONMENTAL_PLANTAIN_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nettle pollen",
    "code": "ENVIRONMENTAL_NETTLE_POLLEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dust mites",
    "code": "ENVIRONMENTAL_DUST_MITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "House dust",
    "code": "ENVIRONMENTAL_HOUSE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Storage mites",
    "code": "ENVIRONMENTAL_STORAGE_MITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mould / mould spores",
    "code": "ENVIRONMENTAL_MOULD_MOULD_SPORES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Penicillium mould",
    "code": "ENVIRONMENTAL_PENICILLIUM_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Aspergillus mould",
    "code": "ENVIRONMENTAL_ASPERGILLUS_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cladosporium mould",
    "code": "ENVIRONMENTAL_CLADOSPORIUM_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Alternaria mould",
    "code": "ENVIRONMENTAL_ALTERNARIA_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cat dander",
    "code": "ENVIRONMENTAL_CAT_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dog dander",
    "code": "ENVIRONMENTAL_DOG_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Horse hair / dander",
    "code": "ENVIRONMENTAL_HORSE_HAIR_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rabbit dander",
    "code": "ENVIRONMENTAL_RABBIT_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Guinea pig dander",
    "code": "ENVIRONMENTAL_GUINEA_PIG_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hamster dander",
    "code": "ENVIRONMENTAL_HAMSTER_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gerbil dander",
    "code": "ENVIRONMENTAL_GERBIL_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ferret dander",
    "code": "ENVIRONMENTAL_FERRET_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bird feathers",
    "code": "ENVIRONMENTAL_BIRD_FEATHERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Parrot dander",
    "code": "ENVIRONMENTAL_PARROT_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cockatoo feathers",
    "code": "ENVIRONMENTAL_COCKATOO_FEATHERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pigeon feathers",
    "code": "ENVIRONMENTAL_PIGEON_FEATHERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cow dander",
    "code": "ENVIRONMENTAL_COW_DANDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sheep wool",
    "code": "ENVIRONMENTAL_SHEEP_WOOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Goat hair",
    "code": "ENVIRONMENTAL_GOAT_HAIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Latex",
    "code": "ENVIRONMENTAL_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nickel (jewellery / metal)",
    "code": "ENVIRONMENTAL_NICKEL_JEWELLERY_METAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cobalt",
    "code": "ENVIRONMENTAL_COBALT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chromium",
    "code": "ENVIRONMENTAL_CHROMIUM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gold jewellery",
    "code": "ENVIRONMENTAL_GOLD_JEWELLERY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silver jewellery",
    "code": "ENVIRONMENTAL_SILVER_JEWELLERY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Copper",
    "code": "ENVIRONMENTAL_COPPER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Zinc",
    "code": "ENVIRONMENTAL_ZINC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fragrance / perfume",
    "code": "ENVIRONMENTAL_FRAGRANCE_PERFUME",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Essential oils",
    "code": "ENVIRONMENTAL_ESSENTIAL_OILS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cosmetics / skincare",
    "code": "ENVIRONMENTAL_COSMETICS_SKINCARE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Make-up",
    "code": "ENVIRONMENTAL_MAKE_UP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Moisturiser ingredients",
    "code": "ENVIRONMENTAL_MOISTURISER_INGREDIENTS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sun cream / sunscreen",
    "code": "ENVIRONMENTAL_SUN_CREAM_SUNSCREEN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Aftersun lotion",
    "code": "ENVIRONMENTAL_AFTERSUN_LOTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shampoo",
    "code": "ENVIRONMENTAL_SHAMPOO",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Conditioner",
    "code": "ENVIRONMENTAL_CONDITIONER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hair spray",
    "code": "ENVIRONMENTAL_HAIR_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hair dye",
    "code": "ENVIRONMENTAL_HAIR_DYE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nail polish",
    "code": "ENVIRONMENTAL_NAIL_POLISH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nail polish remover",
    "code": "ENVIRONMENTAL_NAIL_POLISH_REMOVER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Adhesive tape / plasters",
    "code": "ENVIRONMENTAL_ADHESIVE_TAPE_PLASTERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bandage adhesive",
    "code": "ENVIRONMENTAL_BANDAGE_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chlorine (swimming pools)",
    "code": "ENVIRONMENTAL_CHLORINE_SWIMMING_POOLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bromine (pools)",
    "code": "ENVIRONMENTAL_BROMINE_POOLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bee stings",
    "code": "ENVIRONMENTAL_BEE_STINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wasp stings",
    "code": "ENVIRONMENTAL_WASP_STINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hornet stings",
    "code": "ENVIRONMENTAL_HORNET_STINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ant bites",
    "code": "ENVIRONMENTAL_ANT_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fire ant stings",
    "code": "ENVIRONMENTAL_FIRE_ANT_STINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mosquito bites",
    "code": "ENVIRONMENTAL_MOSQUITO_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Horsefly bites",
    "code": "ENVIRONMENTAL_HORSEFLY_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tick bites",
    "code": "ENVIRONMENTAL_TICK_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flea bites",
    "code": "ENVIRONMENTAL_FLEA_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Midge bites",
    "code": "ENVIRONMENTAL_MIDGE_BITES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Caterpillar hairs",
    "code": "ENVIRONMENTAL_CATERPILLAR_HAIRS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Moth scales",
    "code": "ENVIRONMENTAL_MOTH_SCALES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grass (contact)",
    "code": "ENVIRONMENTAL_GRASS_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hay",
    "code": "ENVIRONMENTAL_HAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Straw",
    "code": "ENVIRONMENTAL_STRAW",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wool",
    "code": "ENVIRONMENTAL_WOOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cashmere",
    "code": "ENVIRONMENTAL_CASHMERE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Angora",
    "code": "ENVIRONMENTAL_ANGORA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Laundry detergent",
    "code": "ENVIRONMENTAL_LAUNDRY_DETERGENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fabric softener",
    "code": "ENVIRONMENTAL_FABRIC_SOFTENER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dry cleaning fluid",
    "code": "ENVIRONMENTAL_DRY_CLEANING_FLUID",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cleaning products",
    "code": "ENVIRONMENTAL_CLEANING_PRODUCTS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bleach",
    "code": "ENVIRONMENTAL_BLEACH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ammonia",
    "code": "ENVIRONMENTAL_AMMONIA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Formaldehyde",
    "code": "ENVIRONMENTAL_FORMALDEHYDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Paint fumes",
    "code": "ENVIRONMENTAL_PAINT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Varnish fumes",
    "code": "ENVIRONMENTAL_VARNISH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Solvents",
    "code": "ENVIRONMENTAL_SOLVENTS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cigarette smoke",
    "code": "ENVIRONMENTAL_CIGARETTE_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vaping aerosol",
    "code": "ENVIRONMENTAL_VAPING_AEROSOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Feather pillows / duvets",
    "code": "ENVIRONMENTAL_FEATHER_PILLOWS_DUVETS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Down bedding",
    "code": "ENVIRONMENTAL_DOWN_BEDDING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rubber gloves",
    "code": "ENVIRONMENTAL_RUBBER_GLOVES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nitrile gloves",
    "code": "ENVIRONMENTAL_NITRILE_GLOVES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vinyl gloves",
    "code": "ENVIRONMENTAL_VINYL_GLOVES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Air conditioning / dry air",
    "code": "ENVIRONMENTAL_AIR_CONDITIONING_DRY_AIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Central heating dry air",
    "code": "ENVIRONMENTAL_CENTRAL_HEATING_DRY_AIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mildew",
    "code": "ENVIRONMENTAL_MILDEW",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Damp walls",
    "code": "ENVIRONMENTAL_DAMP_WALLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carpet dust",
    "code": "ENVIRONMENTAL_CARPET_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sawdust",
    "code": "ENVIRONMENTAL_SAWDUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood dust",
    "code": "ENVIRONMENTAL_WOOD_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flour dust (baker)",
    "code": "ENVIRONMENTAL_FLOUR_DUST_BAKER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grain dust",
    "code": "ENVIRONMENTAL_GRAIN_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Latex paint",
    "code": "ENVIRONMENTAL_LATEX_PAINT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oil paint",
    "code": "ENVIRONMENTAL_OIL_PAINT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Epoxy resin",
    "code": "ENVIRONMENTAL_EPOXY_RESIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fibreglass",
    "code": "ENVIRONMENTAL_FIBREGLASS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Insulation fibres",
    "code": "ENVIRONMENTAL_INSULATION_FIBRES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silica dust",
    "code": "ENVIRONMENTAL_SILICA_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coal dust",
    "code": "ENVIRONMENTAL_COAL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Metalworking fluids",
    "code": "ENVIRONMENTAL_METALWORKING_FLUIDS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Welding fumes",
    "code": "ENVIRONMENTAL_WELDING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Diesel exhaust",
    "code": "ENVIRONMENTAL_DIESEL_EXHAUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Petrol fumes",
    "code": "ENVIRONMENTAL_PETROL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Perfumed candles",
    "code": "ENVIRONMENTAL_PERFUMED_CANDLES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Incense smoke",
    "code": "ENVIRONMENTAL_INCENSE_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood smoke",
    "code": "ENVIRONMENTAL_WOOD_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bonfire smoke",
    "code": "ENVIRONMENTAL_BONFIRE_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "BBQ smoke",
    "code": "ENVIRONMENTAL_BBQ_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mown grass",
    "code": "ENVIRONMENTAL_MOWN_GRASS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Freshly cut hay",
    "code": "ENVIRONMENTAL_FRESHLY_CUT_HAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Compost mould",
    "code": "ENVIRONMENTAL_COMPOST_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mushroom spores",
    "code": "ENVIRONMENTAL_MUSHROOM_SPORES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Indoor plants mould",
    "code": "ENVIRONMENTAL_INDOOR_PLANTS_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Christmas tree mould",
    "code": "ENVIRONMENTAL_CHRISTMAS_TREE_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pine resin",
    "code": "ENVIRONMENTAL_PINE_RESIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ivy (contact)",
    "code": "ENVIRONMENTAL_IVY_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Poison ivy",
    "code": "ENVIRONMENTAL_POISON_IVY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Poison oak",
    "code": "ENVIRONMENTAL_POISON_OAK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Poison sumac",
    "code": "ENVIRONMENTAL_POISON_SUMAC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nettle (contact)",
    "code": "ENVIRONMENTAL_NETTLE_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chrysanthemum (contact)",
    "code": "ENVIRONMENTAL_CHRYSANTHEMUM_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dandelion contact",
    "code": "ENVIRONMENTAL_DANDELION_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lavender (contact)",
    "code": "ENVIRONMENTAL_LAVENDER_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Eucalyptus (inhaled)",
    "code": "ENVIRONMENTAL_EUCALYPTUS_INHALED",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tea tree oil (skin)",
    "code": "ENVIRONMENTAL_TEA_TREE_OIL_SKIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Peppermint oil (skin)",
    "code": "ENVIRONMENTAL_PEPPERMINT_OIL_SKIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lemon oil (skin)",
    "code": "ENVIRONMENTAL_LEMON_OIL_SKIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Patch test adhesive",
    "code": "ENVIRONMENTAL_PATCH_TEST_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Surgical steel",
    "code": "ENVIRONMENTAL_SURGICAL_STEEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Leather (contact)",
    "code": "ENVIRONMENTAL_LEATHER_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Suede",
    "code": "ENVIRONMENTAL_SUEDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Latex balloons",
    "code": "ENVIRONMENTAL_LATEX_BALLOONS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Elastic bands",
    "code": "ENVIRONMENTAL_ELASTIC_BANDS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spandex / Lycra",
    "code": "ENVIRONMENTAL_SPANDEX_LYCRA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Polyester fabric",
    "code": "ENVIRONMENTAL_POLYESTER_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nylon fabric",
    "code": "ENVIRONMENTAL_NYLON_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Acrylic fabric",
    "code": "ENVIRONMENTAL_ACRYLIC_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silk",
    "code": "ENVIRONMENTAL_SILK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cotton (rare)",
    "code": "ENVIRONMENTAL_COTTON_RARE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hemp fabric",
    "code": "ENVIRONMENTAL_HEMP_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Jute",
    "code": "ENVIRONMENTAL_JUTE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coir matting",
    "code": "ENVIRONMENTAL_COIR_MATTING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rope fibres",
    "code": "ENVIRONMENTAL_ROPE_FIBRES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Feather boa",
    "code": "ENVIRONMENTAL_FEATHER_BOA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fur coat",
    "code": "ENVIRONMENTAL_FUR_COAT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Animal saliva (cat)",
    "code": "ENVIRONMENTAL_ANIMAL_SALIVA_CAT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Animal saliva (dog)",
    "code": "ENVIRONMENTAL_ANIMAL_SALIVA_DOG",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Urine proteins (pets)",
    "code": "ENVIRONMENTAL_URINE_PROTEINS_PETS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cockroach droppings",
    "code": "ENVIRONMENTAL_COCKROACH_DROPPINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mouse droppings",
    "code": "ENVIRONMENTAL_MOUSE_DROPPINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rat urine",
    "code": "ENVIRONMENTAL_RAT_URINE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bat guano",
    "code": "ENVIRONMENTAL_BAT_GUANO",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pigeon droppings",
    "code": "ENVIRONMENTAL_PIGEON_DROPPINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mouldy leaves",
    "code": "ENVIRONMENTAL_MOULDY_LEAVES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mulch",
    "code": "ENVIRONMENTAL_MULCH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Peat moss",
    "code": "ENVIRONMENTAL_PEAT_MOSS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bark chippings",
    "code": "ENVIRONMENTAL_BARK_CHIPPINGS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sand (beach)",
    "code": "ENVIRONMENTAL_SAND_BEACH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Seawater (contact)",
    "code": "ENVIRONMENTAL_SEAWATER_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pool algaecide",
    "code": "ENVIRONMENTAL_POOL_ALGAECIDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hot tub chemicals",
    "code": "ENVIRONMENTAL_HOT_TUB_CHEMICALS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mothballs",
    "code": "ENVIRONMENTAL_MOTHBALLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Naphthalene",
    "code": "ENVIRONMENTAL_NAPHTHALENE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Camphor",
    "code": "ENVIRONMENTAL_CAMPHOR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Air fresheners",
    "code": "ENVIRONMENTAL_AIR_FRESHENERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fabric spray",
    "code": "ENVIRONMENTAL_FABRIC_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Disinfectant wipes",
    "code": "ENVIRONMENTAL_DISINFECTANT_WIPES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hand sanitiser (fragranced)",
    "code": "ENVIRONMENTAL_HAND_SANITISER_FRAGRANCED",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Antibacterial soap",
    "code": "ENVIRONMENTAL_ANTIBACTERIAL_SOAP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bar soap (fragranced)",
    "code": "ENVIRONMENTAL_BAR_SOAP_FRAGRANCED",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Deodorant",
    "code": "ENVIRONMENTAL_DEODORANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Antiperspirant",
    "code": "ENVIRONMENTAL_ANTIPERSPIRANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Body spray",
    "code": "ENVIRONMENTAL_BODY_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Talcum powder",
    "code": "ENVIRONMENTAL_TALCUM_POWDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Baby powder",
    "code": "ENVIRONMENTAL_BABY_POWDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lip balm",
    "code": "ENVIRONMENTAL_LIP_BALM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Eye make-up remover",
    "code": "ENVIRONMENTAL_EYE_MAKE_UP_REMOVER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Contact lens solution",
    "code": "ENVIRONMENTAL_CONTACT_LENS_SOLUTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hearing aid mould material",
    "code": "ENVIRONMENTAL_HEARING_AID_MOULD_MATERIAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dental acrylic",
    "code": "ENVIRONMENTAL_DENTAL_ACRYLIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Orthodontic wire nickel",
    "code": "ENVIRONMENTAL_ORTHODONTIC_WIRE_NICKEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tattoo ink",
    "code": "ENVIRONMENTAL_TATTOO_INK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Henna (black)",
    "code": "ENVIRONMENTAL_HENNA_BLACK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hair relaxer",
    "code": "ENVIRONMENTAL_HAIR_RELAXER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Perm solution",
    "code": "ENVIRONMENTAL_PERM_SOLUTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wax strips",
    "code": "ENVIRONMENTAL_WAX_STRIPS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "False eyelash glue",
    "code": "ENVIRONMENTAL_FALSE_EYELASH_GLUE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Printer toner dust",
    "code": "ENVIRONMENTAL_PRINTER_TONER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "New carpet fumes",
    "code": "ENVIRONMENTAL_NEW_CARPET_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "New furniture VOCs",
    "code": "ENVIRONMENTAL_NEW_FURNITURE_VOCS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Drywall dust",
    "code": "ENVIRONMENTAL_DRYWALL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Plaster dust",
    "code": "ENVIRONMENTAL_PLASTER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Concrete dust",
    "code": "ENVIRONMENTAL_CONCRETE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Agricultural pesticides drift",
    "code": "ENVIRONMENTAL_AGRICULTURAL_PESTICIDES_DRIFT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fertiliser dust",
    "code": "ENVIRONMENTAL_FERTILISER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chalk dust",
    "code": "ENVIRONMENTAL_CHALK_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Balloon latex",
    "code": "ENVIRONMENTAL_BALLOON_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Playground rubber mulch",
    "code": "ENVIRONMENTAL_PLAYGROUND_RUBBER_MULCH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Artificial turf crumb rubber",
    "code": "ENVIRONMENTAL_ARTIFICIAL_TURF_CRUMB_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bee pollen contact",
    "code": "ENVIRONMENTAL_BEE_POLLEN_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Propolis contact",
    "code": "ENVIRONMENTAL_PROPOLIS_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Royal jelly contact",
    "code": "ENVIRONMENTAL_ROYAL_JELLY_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shellac nail treatment",
    "code": "ENVIRONMENTAL_SHELLAC_NAIL_TREATMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gel nail polish UV cure fumes",
    "code": "ENVIRONMENTAL_GEL_NAIL_POLISH_UV_CURE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Acrylic nail monomer fumes",
    "code": "ENVIRONMENTAL_ACRYLIC_NAIL_MONOMER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Keratin treatment fumes",
    "code": "ENVIRONMENTAL_KERATIN_TREATMENT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Brazilian blow dry formaldehyde",
    "code": "ENVIRONMENTAL_BRAZILIAN_BLOW_DRY_FORMALDEHYDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spray tan solution",
    "code": "ENVIRONMENTAL_SPRAY_TAN_SOLUTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fake tan DHA reaction",
    "code": "ENVIRONMENTAL_FAKE_TAN_DHA_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Self-tan mitt latex",
    "code": "ENVIRONMENTAL_SELF_TAN_MITT_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Waxing strip adhesive",
    "code": "ENVIRONMENTAL_WAXING_STRIP_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sugar wax residue",
    "code": "ENVIRONMENTAL_SUGAR_WAX_RESIDUE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Threading cotton sensitivity",
    "code": "ENVIRONMENTAL_THREADING_COTTON_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Microblading pigment",
    "code": "ENVIRONMENTAL_MICROBLADING_PIGMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Permanent make-up ink",
    "code": "ENVIRONMENTAL_PERMANENT_MAKE_UP_INK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Laser treatment gel",
    "code": "ENVIRONMENTAL_LASER_TREATMENT_GEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "IPL gel sensitivity",
    "code": "ENVIRONMENTAL_IPL_GEL_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Electrolysis gel",
    "code": "ENVIRONMENTAL_ELECTROLYSIS_GEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Microneedling serum",
    "code": "ENVIRONMENTAL_MICRONEEDLING_SERUM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chemical peel solution fumes",
    "code": "ENVIRONMENTAL_CHEMICAL_PEEL_SOLUTION_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Retinol skincare reaction",
    "code": "ENVIRONMENTAL_RETINOL_SKINCARE_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "AHA skincare reaction",
    "code": "ENVIRONMENTAL_AHA_SKINCARE_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "BHA skincare reaction",
    "code": "ENVIRONMENTAL_BHA_SKINCARE_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vitamin C serum reaction",
    "code": "ENVIRONMENTAL_VITAMIN_C_SERUM_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Niacinamide reaction",
    "code": "ENVIRONMENTAL_NIACINAMIDE_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hyaluronic acid reaction",
    "code": "ENVIRONMENTAL_HYALURONIC_ACID_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ceramide cream reaction",
    "code": "ENVIRONMENTAL_CERAMIDE_CREAM_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Petrolatum sensitivity",
    "code": "ENVIRONMENTAL_PETROLATUM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lanolin wool alcohols",
    "code": "ENVIRONMENTAL_LANOLIN_WOOL_ALCOHOLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Urea cream reaction",
    "code": "ENVIRONMENTAL_UREA_CREAM_REACTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Salicylic acid topical",
    "code": "ENVIRONMENTAL_SALICYLIC_ACID_TOPICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Benzoyl peroxide topical",
    "code": "ENVIRONMENTAL_BENZOYL_PEROXIDE_TOPICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sulphur topical",
    "code": "ENVIRONMENTAL_SULPHUR_TOPICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coal tar topical",
    "code": "ENVIRONMENTAL_COAL_TAR_TOPICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ichthammol ointment",
    "code": "ENVIRONMENTAL_ICHTHAMMOL_OINTMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Zinc oxide cream",
    "code": "ENVIRONMENTAL_ZINC_OXIDE_CREAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Calamine lotion",
    "code": "ENVIRONMENTAL_CALAMINE_LOTION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Antiseptic cream contact",
    "code": "ENVIRONMENTAL_ANTISEPTIC_CREAM_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hydrocortisone cream contact",
    "code": "ENVIRONMENTAL_HYDROCORTISONE_CREAM_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Antifungal cream contact",
    "code": "ENVIRONMENTAL_ANTIFUNGAL_CREAM_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Antibiotic ointment contact",
    "code": "ENVIRONMENTAL_ANTIBIOTIC_OINTMENT_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Eye drop preservative contact",
    "code": "ENVIRONMENTAL_EYE_DROP_PRESERVATIVE_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ear drop contact",
    "code": "ENVIRONMENTAL_EAR_DROP_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nasal spray preservative",
    "code": "ENVIRONMENTAL_NASAL_SPRAY_PRESERVATIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Inhaler propellant",
    "code": "ENVIRONMENTAL_INHALER_PROPELLANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spacer device plastic",
    "code": "ENVIRONMENTAL_SPACER_DEVICE_PLASTIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Peak flow meter mouthpiece",
    "code": "ENVIRONMENTAL_PEAK_FLOW_METER_MOUTHPIECE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nebuliser mask silicone",
    "code": "ENVIRONMENTAL_NEBULISER_MASK_SILICONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oxygen cannula",
    "code": "ENVIRONMENTAL_OXYGEN_CANNULA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "CPAP mask silicone",
    "code": "ENVIRONMENTAL_CPAP_MASK_SILICONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "CPAP hose plasticiser",
    "code": "ENVIRONMENTAL_CPAP_HOSE_PLASTICISER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dental impression putty",
    "code": "ENVIRONMENTAL_DENTAL_IMPRESSION_PUTTY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fluoride varnish",
    "code": "ENVIRONMENTAL_FLUORIDE_VARNISH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dental composite dust",
    "code": "ENVIRONMENTAL_DENTAL_COMPOSITE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Amalgam filling dust",
    "code": "ENVIRONMENTAL_AMALGAM_FILLING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Orthodontic bracket adhesive",
    "code": "ENVIRONMENTAL_ORTHODONTIC_BRACKET_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Retainer plastic",
    "code": "ENVIRONMENTAL_RETAINER_PLASTIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mouth guard material",
    "code": "ENVIRONMENTAL_MOUTH_GUARD_MATERIAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Denture acrylic",
    "code": "ENVIRONMENTAL_DENTURE_ACRYLIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Denture adhesive",
    "code": "ENVIRONMENTAL_DENTURE_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dental floss coating",
    "code": "ENVIRONMENTAL_DENTAL_FLOSS_COATING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Toothpaste flavouring",
    "code": "ENVIRONMENTAL_TOOTHPASTE_FLAVOURING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mouthwash colourant",
    "code": "ENVIRONMENTAL_MOUTHWASH_COLOURANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Whitening strip peroxide",
    "code": "ENVIRONMENTAL_WHITENING_STRIP_PEROXIDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Interdental brush wire",
    "code": "ENVIRONMENTAL_INTERDENTAL_BRUSH_WIRE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tongue scraper metal",
    "code": "ENVIRONMENTAL_TONGUE_SCRAPER_METAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Water flosser tip",
    "code": "ENVIRONMENTAL_WATER_FLOSSER_TIP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hearing aid domes",
    "code": "ENVIRONMENTAL_HEARING_AID_DOMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ear mould acrylic",
    "code": "ENVIRONMENTAL_EAR_MOULD_ACRYLIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cochlear implant patch adhesive",
    "code": "ENVIRONMENTAL_COCHLEAR_IMPLANT_PATCH_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pacemaker patch adhesive",
    "code": "ENVIRONMENTAL_PACEMAKER_PATCH_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "ECG electrode gel",
    "code": "ENVIRONMENTAL_ECG_ELECTRODE_GEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Defibrillator pad gel",
    "code": "ENVIRONMENTAL_DEFIBRILLATOR_PAD_GEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Blood pressure cuff fabric",
    "code": "ENVIRONMENTAL_BLOOD_PRESSURE_CUFF_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pulse oximeter clip",
    "code": "ENVIRONMENTAL_PULSE_OXIMETER_CLIP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Thermometer probe cover",
    "code": "ENVIRONMENTAL_THERMOMETER_PROBE_COVER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stethoscope tubing latex",
    "code": "ENVIRONMENTAL_STETHOSCOPE_TUBING_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tourniquet latex",
    "code": "ENVIRONMENTAL_TOURNIQUET_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "IV tape adhesive",
    "code": "ENVIRONMENTAL_IV_TAPE_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cannula dressing",
    "code": "ENVIRONMENTAL_CANNULA_DRESSING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Central line dressing",
    "code": "ENVIRONMENTAL_CENTRAL_LINE_DRESSING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "PICC line dressing",
    "code": "ENVIRONMENTAL_PICC_LINE_DRESSING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stoma bag adhesive",
    "code": "ENVIRONMENTAL_STOMA_BAG_ADHESIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stoma paste",
    "code": "ENVIRONMENTAL_STOMA_PASTE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Barrier film spray",
    "code": "ENVIRONMENTAL_BARRIER_FILM_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Barrier wipe",
    "code": "ENVIRONMENTAL_BARRIER_WIPE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Incontinence pad fragrance",
    "code": "ENVIRONMENTAL_INCONTINENCE_PAD_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nappy cream fragrance",
    "code": "ENVIRONMENTAL_NAPPY_CREAM_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Baby wipe fragrance",
    "code": "ENVIRONMENTAL_BABY_WIPE_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wet wipe preservative",
    "code": "ENVIRONMENTAL_WET_WIPE_PRESERVATIVE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hand cream fragrance",
    "code": "ENVIRONMENTAL_HAND_CREAM_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Barrier cream clinical",
    "code": "ENVIRONMENTAL_BARRIER_CREAM_CLINICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Emollient paraffin",
    "code": "ENVIRONMENTAL_EMOLLIENT_PARAFFIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Aqueous cream sensitivity",
    "code": "ENVIRONMENTAL_AQUEOUS_CREAM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Diprobase sensitivity",
    "code": "ENVIRONMENTAL_DIPROBASE_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cetraben sensitivity",
    "code": "ENVIRONMENTAL_CETRABEN_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Doublebase sensitivity",
    "code": "ENVIRONMENTAL_DOUBLEBASE_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Epaderm sensitivity",
    "code": "ENVIRONMENTAL_EPADERM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hydromol sensitivity",
    "code": "ENVIRONMENTAL_HYDROMOL_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oilatum sensitivity",
    "code": "ENVIRONMENTAL_OILATUM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "E45 cream sensitivity",
    "code": "ENVIRONMENTAL_E45_CREAM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sudocrem sensitivity",
    "code": "ENVIRONMENTAL_SUDOCREM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Metanium sensitivity",
    "code": "ENVIRONMENTAL_METANIUM_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Zinc and castor oil cream",
    "code": "ENVIRONMENTAL_ZINC_AND_CASTOR_OIL_CREAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Savlon sensitivity",
    "code": "ENVIRONMENTAL_SAVLON_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dettol sensitivity",
    "code": "ENVIRONMENTAL_DETTOL_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "TCP sensitivity",
    "code": "ENVIRONMENTAL_TCP_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Betadine sensitivity",
    "code": "ENVIRONMENTAL_BETADINE_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Povidone iodine skin",
    "code": "ENVIRONMENTAL_POVIDONE_IODINE_SKIN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chlorhexidine skin wash",
    "code": "ENVIRONMENTAL_CHLORHEXIDINE_SKIN_WASH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hibiscrub sensitivity",
    "code": "ENVIRONMENTAL_HIBISCRUB_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Surgical scrub brush",
    "code": "ENVIRONMENTAL_SURGICAL_SCRUB_BRUSH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Operating theatre latex dust",
    "code": "ENVIRONMENTAL_OPERATING_THEATRE_LATEX_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital laundry detergent",
    "code": "ENVIRONMENTAL_HOSPITAL_LAUNDRY_DETERGENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital bed linen starch",
    "code": "ENVIRONMENTAL_HOSPITAL_BED_LINEN_STARCH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital blanket wool",
    "code": "ENVIRONMENTAL_HOSPITAL_BLANKET_WOOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital pillow latex",
    "code": "ENVIRONMENTAL_HOSPITAL_PILLOW_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wheelchair tyre rubber",
    "code": "ENVIRONMENTAL_WHEELCHAIR_TYRE_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Walking frame rubber feet",
    "code": "ENVIRONMENTAL_WALKING_FRAME_RUBBER_FEET",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Zimmer frame grip",
    "code": "ENVIRONMENTAL_ZIMMER_FRAME_GRIP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rollator handle foam",
    "code": "ENVIRONMENTAL_ROLLATOR_HANDLE_FOAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Commode plastic fumes",
    "code": "ENVIRONMENTAL_COMMODE_PLASTIC_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bed pan plastic",
    "code": "ENVIRONMENTAL_BED_PAN_PLASTIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Urinal plastic",
    "code": "ENVIRONMENTAL_URINAL_PLASTIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Slipper bath hoist sling",
    "code": "ENVIRONMENTAL_SLIPPER_BATH_HOIST_SLING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Patient transfer sheet",
    "code": "ENVIRONMENTAL_PATIENT_TRANSFER_SHEET",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Slide sheet fabric",
    "code": "ENVIRONMENTAL_SLIDE_SHEET_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Turning disc material",
    "code": "ENVIRONMENTAL_TURNING_DISC_MATERIAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Profiling bed motor dust",
    "code": "ENVIRONMENTAL_PROFILING_BED_MOTOR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital curtain fabric",
    "code": "ENVIRONMENTAL_HOSPITAL_CURTAIN_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Privacy screen fabric",
    "code": "ENVIRONMENTAL_PRIVACY_SCREEN_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Waiting room chair vinyl",
    "code": "ENVIRONMENTAL_WAITING_ROOM_CHAIR_VINYL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vinyl flooring fumes",
    "code": "ENVIRONMENTAL_VINYL_FLOORING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Linoleum fumes",
    "code": "ENVIRONMENTAL_LINOLEUM_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rubber flooring gym",
    "code": "ENVIRONMENTAL_RUBBER_FLOORING_GYM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cork flooring sealant",
    "code": "ENVIRONMENTAL_CORK_FLOORING_SEALANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Laminate VOCs",
    "code": "ENVIRONMENTAL_LAMINATE_VOCS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "MDF dust workshop",
    "code": "ENVIRONMENTAL_MDF_DUST_WORKSHOP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sawmill cedar dust",
    "code": "ENVIRONMENTAL_SAWMILL_CEDAR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Teak dust",
    "code": "ENVIRONMENTAL_TEAK_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mahogany dust",
    "code": "ENVIRONMENTAL_MAHOGANY_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oak dust",
    "code": "ENVIRONMENTAL_OAK_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pine dust",
    "code": "ENVIRONMENTAL_PINE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bamboo dust",
    "code": "ENVIRONMENTAL_BAMBOO_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coconut husk dust",
    "code": "ENVIRONMENTAL_COCONUT_HUSK_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Jute dust",
    "code": "ENVIRONMENTAL_JUTE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cotton dust textile mill",
    "code": "ENVIRONMENTAL_COTTON_DUST_TEXTILE_MILL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flax dust",
    "code": "ENVIRONMENTAL_FLAX_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hemp dust",
    "code": "ENVIRONMENTAL_HEMP_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sisal dust",
    "code": "ENVIRONMENTAL_SISAL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Feather processing dust",
    "code": "ENVIRONMENTAL_FEATHER_PROCESSING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Down processing dust",
    "code": "ENVIRONMENTAL_DOWN_PROCESSING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Leather tanning fumes",
    "code": "ENVIRONMENTAL_LEATHER_TANNING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shoe factory glue fumes",
    "code": "ENVIRONMENTAL_SHOE_FACTORY_GLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rubber factory fumes",
    "code": "ENVIRONMENTAL_RUBBER_FACTORY_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tyre warehouse fumes",
    "code": "ENVIRONMENTAL_TYRE_WAREHOUSE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Battery acid fumes",
    "code": "ENVIRONMENTAL_BATTERY_ACID_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Printer ink fumes",
    "code": "ENVIRONMENTAL_PRINTER_INK_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Photocopier ozone",
    "code": "ENVIRONMENTAL_PHOTOCOPIER_OZONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "3D printer resin fumes",
    "code": "ENVIRONMENTAL_3D_PRINTER_RESIN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Solder flux fumes",
    "code": "ENVIRONMENTAL_SOLDER_FLUX_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flux paste fumes",
    "code": "ENVIRONMENTAL_FLUX_PASTE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rosin solder fumes",
    "code": "ENVIRONMENTAL_ROSIN_SOLDER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lead solder fumes (historical)",
    "code": "ENVIRONMENTAL_LEAD_SOLDER_FUMES_HISTORICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Welding rod fumes",
    "code": "ENVIRONMENTAL_WELDING_ROD_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Galvanising fumes",
    "code": "ENVIRONMENTAL_GALVANISING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chrome plating fumes",
    "code": "ENVIRONMENTAL_CHROME_PLATING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nickel plating fumes",
    "code": "ENVIRONMENTAL_NICKEL_PLATING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Anodising fumes",
    "code": "ENVIRONMENTAL_ANODISING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Powder coat curing fumes",
    "code": "ENVIRONMENTAL_POWDER_COAT_CURING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spray paint booth fumes",
    "code": "ENVIRONMENTAL_SPRAY_PAINT_BOOTH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Auto body filler fumes",
    "code": "ENVIRONMENTAL_AUTO_BODY_FILLER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fibreglass resin fumes",
    "code": "ENVIRONMENTAL_FIBREGLASS_RESIN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carbon fibre dust",
    "code": "ENVIRONMENTAL_CARBON_FIBRE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Kevlar dust",
    "code": "ENVIRONMENTAL_KEVLAR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Asbestos disturbance (historical)",
    "code": "ENVIRONMENTAL_ASBESTOS_DISTURBANCE_HISTORICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vermiculite dust",
    "code": "ENVIRONMENTAL_VERMICULITE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Perlite dust",
    "code": "ENVIRONMENTAL_PERLITE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rock wool insulation",
    "code": "ENVIRONMENTAL_ROCK_WOOL_INSULATION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Glass wool insulation",
    "code": "ENVIRONMENTAL_GLASS_WOOL_INSULATION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spray foam insulation isocyanate",
    "code": "ENVIRONMENTAL_SPRAY_FOAM_INSULATION_ISOCYANATE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Isocyanate paint",
    "code": "ENVIRONMENTAL_ISOCYANATE_PAINT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Two-pack paint hardener",
    "code": "ENVIRONMENTAL_TWO_PACK_PAINT_HARDENER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Marine antifoul paint",
    "code": "ENVIRONMENTAL_MARINE_ANTIFOUL_PAINT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Boat varnish fumes",
    "code": "ENVIRONMENTAL_BOAT_VARNISH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Yacht teak oil fumes",
    "code": "ENVIRONMENTAL_YACHT_TEAK_OIL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Deck sealant fumes",
    "code": "ENVIRONMENTAL_DECK_SEALANT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silicone bathroom sealant",
    "code": "ENVIRONMENTAL_SILICONE_BATHROOM_SEALANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grout sealant fumes",
    "code": "ENVIRONMENTAL_GROUT_SEALANT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tile adhesive fumes",
    "code": "ENVIRONMENTAL_TILE_ADHESIVE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Thinset mortar dust",
    "code": "ENVIRONMENTAL_THINSET_MORTAR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cement bag dust",
    "code": "ENVIRONMENTAL_CEMENT_BAG_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lime wash dust",
    "code": "ENVIRONMENTAL_LIME_WASH_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gypsum dust",
    "code": "ENVIRONMENTAL_GYPSUM_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Plaster of Paris dust",
    "code": "ENVIRONMENTAL_PLASTER_OF_PARIS_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Joint compound dust",
    "code": "ENVIRONMENTAL_JOINT_COMPOUND_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spackle dust",
    "code": "ENVIRONMENTAL_SPACKLE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sandpaper dust",
    "code": "ENVIRONMENTAL_SANDPAPER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Abrasive blasting dust",
    "code": "ENVIRONMENTAL_ABRASIVE_BLASTING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shot blasting dust",
    "code": "ENVIRONMENTAL_SHOT_BLASTING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grinding metal sparks dust",
    "code": "ENVIRONMENTAL_GRINDING_METAL_SPARKS_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cutting fluid mist",
    "code": "ENVIRONMENTAL_CUTTING_FLUID_MIST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coolant mist machining",
    "code": "ENVIRONMENTAL_COOLANT_MIST_MACHINING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hydraulic oil mist",
    "code": "ENVIRONMENTAL_HYDRAULIC_OIL_MIST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Compressor oil mist",
    "code": "ENVIRONMENTAL_COMPRESSOR_OIL_MIST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Diesel particulate",
    "code": "ENVIRONMENTAL_DIESEL_PARTICULATE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Petrol vapour forecourt",
    "code": "ENVIRONMENTAL_PETROL_VAPOUR_FORECOURT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "LPG vapour",
    "code": "ENVIRONMENTAL_LPG_VAPOUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Natural gas leak sensitivity",
    "code": "ENVIRONMENTAL_NATURAL_GAS_LEAK_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Propane fumes",
    "code": "ENVIRONMENTAL_PROPANE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Butane lighter fuel",
    "code": "ENVIRONMENTAL_BUTANE_LIGHTER_FUEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Kerosene heater fumes",
    "code": "ENVIRONMENTAL_KEROSENE_HEATER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Paraffin lamp fumes",
    "code": "ENVIRONMENTAL_PARAFFIN_LAMP_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coal fire soot",
    "code": "ENVIRONMENTAL_COAL_FIRE_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood pellet stove dust",
    "code": "ENVIRONMENTAL_WOOD_PELLET_STOVE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Biomass boiler dust",
    "code": "ENVIRONMENTAL_BIOMASS_BOILER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Incinerator ash dust",
    "code": "ENVIRONMENTAL_INCINERATOR_ASH_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Landfill methane odour",
    "code": "ENVIRONMENTAL_LANDFILL_METHANE_ODOUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sewage treatment odour",
    "code": "ENVIRONMENTAL_SEWAGE_TREATMENT_ODOUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Manure farm odour",
    "code": "ENVIRONMENTAL_MANURE_FARM_ODOUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silage farm fumes",
    "code": "ENVIRONMENTAL_SILAGE_FARM_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Poultry house dust",
    "code": "ENVIRONMENTAL_POULTRY_HOUSE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pig farm ammonia",
    "code": "ENVIRONMENTAL_PIG_FARM_AMMONIA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stable ammonia",
    "code": "ENVIRONMENTAL_STABLE_AMMONIA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hay barn mould",
    "code": "ENVIRONMENTAL_HAY_BARN_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grain silo dust",
    "code": "ENVIRONMENTAL_GRAIN_SILO_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cotton gin dust",
    "code": "ENVIRONMENTAL_COTTON_GIN_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tobacco leaf dust",
    "code": "ENVIRONMENTAL_TOBACCO_LEAF_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Coffee bean dust",
    "code": "ENVIRONMENTAL_COFFEE_BEAN_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spice mill dust",
    "code": "ENVIRONMENTAL_SPICE_MILL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pepper dust",
    "code": "ENVIRONMENTAL_PEPPER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chilli processing dust",
    "code": "ENVIRONMENTAL_CHILLI_PROCESSING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mustard seed dust",
    "code": "ENVIRONMENTAL_MUSTARD_SEED_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flour mill dust",
    "code": "ENVIRONMENTAL_FLOUR_MILL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bakery oven fumes",
    "code": "ENVIRONMENTAL_BAKERY_OVEN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Roasting nut fumes",
    "code": "ENVIRONMENTAL_ROASTING_NUT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fish market odour",
    "code": "ENVIRONMENTAL_FISH_MARKET_ODOUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shellfish steam",
    "code": "ENVIRONMENTAL_SHELLFISH_STEAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Meat processing cold room mould",
    "code": "ENVIRONMENTAL_MEAT_PROCESSING_COLD_ROOM_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Butcher saw bone dust",
    "code": "ENVIRONMENTAL_BUTCHER_SAW_BONE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Abattoir fumes",
    "code": "ENVIRONMENTAL_ABATTOIR_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tannery fumes",
    "code": "ENVIRONMENTAL_TANNERY_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wool scour fumes",
    "code": "ENVIRONMENTAL_WOOL_SCOUR_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dry cleaner PERC fumes",
    "code": "ENVIRONMENTAL_DRY_CLEANER_PERC_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Laundry starch spray",
    "code": "ENVIRONMENTAL_LAUNDRY_STARCH_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ironing water fragrance",
    "code": "ENVIRONMENTAL_IRONING_WATER_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Steam iron scale dust",
    "code": "ENVIRONMENTAL_STEAM_IRON_SCALE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vacuum cleaner dust bag",
    "code": "ENVIRONMENTAL_VACUUM_CLEANER_DUST_BAG",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Robot vacuum dust",
    "code": "ENVIRONMENTAL_ROBOT_VACUUM_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Air purifier HEPA dust change",
    "code": "ENVIRONMENTAL_AIR_PURIFIER_HEPA_DUST_CHANGE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dehumidifier filter mould",
    "code": "ENVIRONMENTAL_DEHUMIDIFIER_FILTER_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Humidifier pink mould",
    "code": "ENVIRONMENTAL_HUMIDIFIER_PINK_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Essential oil diffuser mist",
    "code": "ENVIRONMENTAL_ESSENTIAL_OIL_DIFFUSER_MIST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Reed diffuser oil",
    "code": "ENVIRONMENTAL_REED_DIFFUSER_OIL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pot pourri dust",
    "code": "ENVIRONMENTAL_POT_POURRI_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Scented drawer liners",
    "code": "ENVIRONMENTAL_SCENTED_DRAWER_LINERS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Moth repellent sachet",
    "code": "ENVIRONMENTAL_MOTH_REPELLENT_SACHET",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cedar wood moth balls",
    "code": "ENVIRONMENTAL_CEDAR_WOOD_MOTH_BALLS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lavender sachet dust",
    "code": "ENVIRONMENTAL_LAVENDER_SACHET_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wardrobe mould",
    "code": "ENVIRONMENTAL_WARDROBE_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Attic insulation disturbance",
    "code": "ENVIRONMENTAL_ATTIC_INSULATION_DISTURBANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Loft fibreglass disturbance",
    "code": "ENVIRONMENTAL_LOFT_FIBREGLASS_DISTURBANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cavity wall insulation dust",
    "code": "ENVIRONMENTAL_CAVITY_WALL_INSULATION_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Draught excluder rubber",
    "code": "ENVIRONMENTAL_DRAUGHT_EXCLUDER_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Door seal rubber",
    "code": "ENVIRONMENTAL_DOOR_SEAL_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Window seal silicone",
    "code": "ENVIRONMENTAL_WINDOW_SEAL_SILICONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Glazing putty fumes",
    "code": "ENVIRONMENTAL_GLAZING_PUTTY_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Double glazing seal failure mould",
    "code": "ENVIRONMENTAL_DOUBLE_GLAZING_SEAL_FAILURE_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Condensation mould window",
    "code": "ENVIRONMENTAL_CONDENSATION_MOULD_WINDOW",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bathroom extractor mould",
    "code": "ENVIRONMENTAL_BATHROOM_EXTRACTOR_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shower curtain mould",
    "code": "ENVIRONMENTAL_SHOWER_CURTAIN_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bath sealant black mould",
    "code": "ENVIRONMENTAL_BATH_SEALANT_BLACK_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tile grout mould",
    "code": "ENVIRONMENTAL_TILE_GROUT_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silicone mould bathroom",
    "code": "ENVIRONMENTAL_SILICONE_MOULD_BATHROOM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Kitchen grease aerosol",
    "code": "ENVIRONMENTAL_KITCHEN_GREASE_AEROSOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Extractor fan grease",
    "code": "ENVIRONMENTAL_EXTRACTOR_FAN_GREASE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oven cleaner fumes",
    "code": "ENVIRONMENTAL_OVEN_CLEANER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Grill cleaner fumes",
    "code": "ENVIRONMENTAL_GRILL_CLEANER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Drain unblocker fumes",
    "code": "ENVIRONMENTAL_DRAIN_UNBLOCKER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bleach toilet fumes",
    "code": "ENVIRONMENTAL_BLEACH_TOILET_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mould remover chlorine",
    "code": "ENVIRONMENTAL_MOULD_REMOVER_CHLORINE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ammonia glass cleaner",
    "code": "ENVIRONMENTAL_AMMONIA_GLASS_CLEANER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Furniture polish spray",
    "code": "ENVIRONMENTAL_FURNITURE_POLISH_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood wax fumes",
    "code": "ENVIRONMENTAL_WOOD_WAX_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Metal polish fumes",
    "code": "ENVIRONMENTAL_METAL_POLISH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Brass cleaner ammonia",
    "code": "ENVIRONMENTAL_BRASS_CLEANER_AMMONIA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Silver dip fumes",
    "code": "ENVIRONMENTAL_SILVER_DIP_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rust remover acid fumes",
    "code": "ENVIRONMENTAL_RUST_REMOVER_ACID_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lime scale remover acid",
    "code": "ENVIRONMENTAL_LIME_SCALE_REMOVER_ACID",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oven pyrolytic clean fumes",
    "code": "ENVIRONMENTAL_OVEN_PYROLYTIC_CLEAN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Self-clean oven fumes",
    "code": "ENVIRONMENTAL_SELF_CLEAN_OVEN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dishwasher steam chemical",
    "code": "ENVIRONMENTAL_DISHWASHER_STEAM_CHEMICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Washing machine mould seal",
    "code": "ENVIRONMENTAL_WASHING_MACHINE_MOULD_SEAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tumble dryer lint mould",
    "code": "ENVIRONMENTAL_TUMBLE_DRYER_LINT_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ironing board cover formaldehyde",
    "code": "ENVIRONMENTAL_IRONING_BOARD_COVER_FORMALDEHYDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Clothes moth treatment",
    "code": "ENVIRONMENTAL_CLOTHES_MOTH_TREATMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carpet beetle treatment spray",
    "code": "ENVIRONMENTAL_CARPET_BEETLE_TREATMENT_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flea spray home",
    "code": "ENVIRONMENTAL_FLEA_SPRAY_HOME",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ant powder",
    "code": "ENVIRONMENTAL_ANT_POWDER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wasp nest spray",
    "code": "ENVIRONMENTAL_WASP_NEST_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fly spray",
    "code": "ENVIRONMENTAL_FLY_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mosquito coil smoke",
    "code": "ENVIRONMENTAL_MOSQUITO_COIL_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Citronella candle smoke",
    "code": "ENVIRONMENTAL_CITRONELLA_CANDLE_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bug zapper dust",
    "code": "ENVIRONMENTAL_BUG_ZAPPER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Garden pesticide spray drift",
    "code": "ENVIRONMENTAL_GARDEN_PESTICIDE_SPRAY_DRIFT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Weedkiller spray drift",
    "code": "ENVIRONMENTAL_WEEDKILLER_SPRAY_DRIFT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Roundup-style herbicide drift",
    "code": "ENVIRONMENTAL_ROUNDUP_STYLE_HERBICIDE_DRIFT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lawn feed dust",
    "code": "ENVIRONMENTAL_LAWN_FEED_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bonemeal dust",
    "code": "ENVIRONMENTAL_BONEMEAL_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fish blood and bone dust",
    "code": "ENVIRONMENTAL_FISH_BLOOD_AND_BONE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Compost activator dust",
    "code": "ENVIRONMENTAL_COMPOST_ACTIVATOR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mushroom compost spores",
    "code": "ENVIRONMENTAL_MUSHROOM_COMPOST_SPORES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Greenhouse mould",
    "code": "ENVIRONMENTAL_GREENHOUSE_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Polytunnel plastic fumes",
    "code": "ENVIRONMENTAL_POLYTUNNEL_PLASTIC_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Garden hose rubber taste",
    "code": "ENVIRONMENTAL_GARDEN_HOSE_RUBBER_TASTE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hose reel mould",
    "code": "ENVIRONMENTAL_HOSE_REEL_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Water butt algae",
    "code": "ENVIRONMENTAL_WATER_BUTT_ALGAE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pond algae bloom",
    "code": "ENVIRONMENTAL_POND_ALGAE_BLOOM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fish pond treatment",
    "code": "ENVIRONMENTAL_FISH_POND_TREATMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chlorine garden pool",
    "code": "ENVIRONMENTAL_CHLORINE_GARDEN_POOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hot tub bromine",
    "code": "ENVIRONMENTAL_HOT_TUB_BROMINE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sauna cedar fumes",
    "code": "ENVIRONMENTAL_SAUNA_CEDAR_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Steam room eucalyptus",
    "code": "ENVIRONMENTAL_STEAM_ROOM_EUCALYPTUS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spa chlorine",
    "code": "ENVIRONMENTAL_SPA_CHLORINE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Jacuzzi foam treatment",
    "code": "ENVIRONMENTAL_JACUZZI_FOAM_TREATMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Swimming goggles strap",
    "code": "ENVIRONMENTAL_SWIMMING_GOGGLES_STRAP",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Swim cap latex",
    "code": "ENVIRONMENTAL_SWIM_CAP_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wetsuit neoprene",
    "code": "ENVIRONMENTAL_WETSUIT_NEOPRENE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Surf wax",
    "code": "ENVIRONMENTAL_SURF_WAX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Board wax fumes",
    "code": "ENVIRONMENTAL_BOARD_WAX_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ski wax fumes",
    "code": "ENVIRONMENTAL_SKI_WAX_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Snow chain rubber",
    "code": "ENVIRONMENTAL_SNOW_CHAIN_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Car air freshener",
    "code": "ENVIRONMENTAL_CAR_AIR_FRESHENER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Car seat fabric",
    "code": "ENVIRONMENTAL_CAR_SEAT_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Car upholstery VOCs",
    "code": "ENVIRONMENTAL_CAR_UPHOLSTERY_VOCS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "New car smell VOCs",
    "code": "ENVIRONMENTAL_NEW_CAR_SMELL_VOCS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Taxi fabric",
    "code": "ENVIRONMENTAL_TAXI_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bus seat fabric",
    "code": "ENVIRONMENTAL_BUS_SEAT_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Train seat fabric",
    "code": "ENVIRONMENTAL_TRAIN_SEAT_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Airplane seat fabric",
    "code": "ENVIRONMENTAL_AIRPLANE_SEAT_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Airplane cabin air",
    "code": "ENVIRONMENTAL_AIRPLANE_CABIN_AIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cruise ship ventilation",
    "code": "ENVIRONMENTAL_CRUISE_SHIP_VENTILATION",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hotel bedding detergent",
    "code": "ENVIRONMENTAL_HOTEL_BEDDING_DETERGENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Holiday rental mould",
    "code": "ENVIRONMENTAL_HOLIDAY_RENTAL_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Caravan damp mould",
    "code": "ENVIRONMENTAL_CARAVAN_DAMP_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Camping tent mildew",
    "code": "ENVIRONMENTAL_CAMPING_TENT_MILDEW",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sleeping bag down",
    "code": "ENVIRONMENTAL_SLEEPING_BAG_DOWN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Camping mat foam",
    "code": "ENVIRONMENTAL_CAMPING_MAT_FOAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hiking boot leather",
    "code": "ENVIRONMENTAL_HIKING_BOOT_LEATHER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gaiter fabric",
    "code": "ENVIRONMENTAL_GAITER_FABRIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rain jacket PU coating",
    "code": "ENVIRONMENTAL_RAIN_JACKET_PU_COATING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gore-Tex sensitivity",
    "code": "ENVIRONMENTAL_GORE_TEX_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Waterproof spray PFAS",
    "code": "ENVIRONMENTAL_WATERPROOF_SPRAY_PFAS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "DWR coating fumes",
    "code": "ENVIRONMENTAL_DWR_COATING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tent waterproof spray",
    "code": "ENVIRONMENTAL_TENT_WATERPROOF_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Climbing rope fibres",
    "code": "ENVIRONMENTAL_CLIMBING_ROPE_FIBRES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carabiner nickel",
    "code": "ENVIRONMENTAL_CARABINER_NICKEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Harness nylon",
    "code": "ENVIRONMENTAL_HARNESS_NYLON",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Helmet foam",
    "code": "ENVIRONMENTAL_HELMET_FOAM",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bike helmet padding",
    "code": "ENVIRONMENTAL_BIKE_HELMET_PADDING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cycling gloves latex",
    "code": "ENVIRONMENTAL_CYCLING_GLOVES_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Handlebar tape rubber",
    "code": "ENVIRONMENTAL_HANDLEBAR_TAPE_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gym equipment rubber handles",
    "code": "ENVIRONMENTAL_GYM_EQUIPMENT_RUBBER_HANDLES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Yoga mat PVC",
    "code": "ENVIRONMENTAL_YOGA_MAT_PVC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Yoga mat TPE",
    "code": "ENVIRONMENTAL_YOGA_MAT_TPE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Resistance band latex",
    "code": "ENVIRONMENTAL_RESISTANCE_BAND_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Foam roller chemicals",
    "code": "ENVIRONMENTAL_FOAM_ROLLER_CHEMICALS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Weight bench vinyl",
    "code": "ENVIRONMENTAL_WEIGHT_BENCH_VINYL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Boxing glove leather",
    "code": "ENVIRONMENTAL_BOXING_GLOVE_LEATHER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Martial arts mat rubber",
    "code": "ENVIRONMENTAL_MARTIAL_ARTS_MAT_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Swimming pool changing room mould",
    "code": "ENVIRONMENTAL_SWIMMING_POOL_CHANGING_ROOM_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Locker room mould",
    "code": "ENVIRONMENTAL_LOCKER_ROOM_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shower gel fragrance communal",
    "code": "ENVIRONMENTAL_SHOWER_GEL_FRAGRANCE_COMMUNAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hair salon chemical fumes",
    "code": "ENVIRONMENTAL_HAIR_SALON_CHEMICAL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Nail salon fumes",
    "code": "ENVIRONMENTAL_NAIL_SALON_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tanning bed acrylic",
    "code": "ENVIRONMENTAL_TANNING_BED_ACRYLIC",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Spa hot stone oil",
    "code": "ENVIRONMENTAL_SPA_HOT_STONE_OIL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Massage table vinyl",
    "code": "ENVIRONMENTAL_MASSAGE_TABLE_VINYL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Aromatherapy burner oil",
    "code": "ENVIRONMENTAL_AROMATHERAPY_BURNER_OIL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Church incense",
    "code": "ENVIRONMENTAL_CHURCH_INCENSE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Funeral home formaldehyde",
    "code": "ENVIRONMENTAL_FUNERAL_HOME_FORMALDEHYDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hospital mortuary formaldehyde trace",
    "code": "ENVIRONMENTAL_HOSPITAL_MORTUARY_FORMALDEHYDE_TRACE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Embalming fluid trace",
    "code": "ENVIRONMENTAL_EMBALMING_FLUID_TRACE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Museum display case formaldehyde",
    "code": "ENVIRONMENTAL_MUSEUM_DISPLAY_CASE_FORMALDEHYDE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Library book mould",
    "code": "ENVIRONMENTAL_LIBRARY_BOOK_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Old paper dust",
    "code": "ENVIRONMENTAL_OLD_PAPER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Parchment dust",
    "code": "ENVIRONMENTAL_PARCHMENT_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Art gallery varnish fumes",
    "code": "ENVIRONMENTAL_ART_GALLERY_VARNISH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stage smoke machine",
    "code": "ENVIRONMENTAL_STAGE_SMOKE_MACHINE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Theatre dust curtains",
    "code": "ENVIRONMENTAL_THEATRE_DUST_CURTAINS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Concert fog fluid",
    "code": "ENVIRONMENTAL_CONCERT_FOG_FLUID",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fireworks smoke",
    "code": "ENVIRONMENTAL_FIREWORKS_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bonfire night smoke",
    "code": "ENVIRONMENTAL_BONFIRE_NIGHT_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cigarette ash contact",
    "code": "ENVIRONMENTAL_CIGARETTE_ASH_CONTACT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cigar smoke",
    "code": "ENVIRONMENTAL_CIGAR_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pipe tobacco smoke",
    "code": "ENVIRONMENTAL_PIPE_TOBACCO_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shisha smoke",
    "code": "ENVIRONMENTAL_SHISHA_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hookah charcoal fumes",
    "code": "ENVIRONMENTAL_HOOKAH_CHARCOAL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Vape flavouring aerosol",
    "code": "ENVIRONMENTAL_VAPE_FLAVOURING_AEROSOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cannabis smoke (secondhand)",
    "code": "ENVIRONMENTAL_CANNABIS_SMOKE_SECONDHAND",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Incense temple smoke",
    "code": "ENVIRONMENTAL_INCENSE_TEMPLE_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cremation ash windborne",
    "code": "ENVIRONMENTAL_CREMATION_ASH_WINDBORNE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Volcanic ash (travel)",
    "code": "ENVIRONMENTAL_VOLCANIC_ASH_TRAVEL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Saharan dust cloud",
    "code": "ENVIRONMENTAL_SAHARAN_DUST_CLOUD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pollution particulate urban",
    "code": "ENVIRONMENTAL_POLLUTION_PARTICULATE_URBAN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Traffic tunnel fumes",
    "code": "ENVIRONMENTAL_TRAFFIC_TUNNEL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Underground metro brake dust",
    "code": "ENVIRONMENTAL_UNDERGROUND_METRO_BRAKE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Railway brake dust",
    "code": "ENVIRONMENTAL_RAILWAY_BRAKE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ship engine exhaust port",
    "code": "ENVIRONMENTAL_SHIP_ENGINE_EXHAUST_PORT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Helicopter fuel fumes",
    "code": "ENVIRONMENTAL_HELICOPTER_FUEL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Aviation fuel fumes",
    "code": "ENVIRONMENTAL_AVIATION_FUEL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Jet exhaust particulate",
    "code": "ENVIRONMENTAL_JET_EXHAUST_PARTICULATE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Kerosene lamp indoor",
    "code": "ENVIRONMENTAL_KEROSENE_LAMP_INDOOR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oil lamp soot",
    "code": "ENVIRONMENTAL_OIL_LAMP_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Candle paraffin soot",
    "code": "ENVIRONMENTAL_CANDLE_PARAFFIN_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Beeswax candle soot",
    "code": "ENVIRONMENTAL_BEESWAX_CANDLE_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Soy candle fragrance",
    "code": "ENVIRONMENTAL_SOY_CANDLE_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wick trim metal",
    "code": "ENVIRONMENTAL_WICK_TRIM_METAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Matches sulphur",
    "code": "ENVIRONMENTAL_MATCHES_SULPHUR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lighter fluid fumes",
    "code": "ENVIRONMENTAL_LIGHTER_FLUID_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Firelighter block fumes",
    "code": "ENVIRONMENTAL_FIRELIGHTER_BLOCK_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Barbecue lighter fluid",
    "code": "ENVIRONMENTAL_BARBECUE_LIGHTER_FLUID",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Charcoal starter fumes",
    "code": "ENVIRONMENTAL_CHARCOAL_STARTER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Smoking wood chip fumes",
    "code": "ENVIRONMENTAL_SMOKING_WOOD_CHIP_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Smoker grill fumes",
    "code": "ENVIRONMENTAL_SMOKER_GRILL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pizza oven wood smoke",
    "code": "ENVIRONMENTAL_PIZZA_OVEN_WOOD_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tandoor oven smoke",
    "code": "ENVIRONMENTAL_TANDOOR_OVEN_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chimney sweep soot",
    "code": "ENVIRONMENTAL_CHIMNEY_SWEEP_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flue soot disturbance",
    "code": "ENVIRONMENTAL_FLUE_SOOT_DISTURBANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Open fire soot",
    "code": "ENVIRONMENTAL_OPEN_FIRE_SOOT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gas fire ceramic dust",
    "code": "ENVIRONMENTAL_GAS_FIRE_CERAMIC_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Electric fire dust burn",
    "code": "ENVIRONMENTAL_ELECTRIC_FIRE_DUST_BURN",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Storage heater dust",
    "code": "ENVIRONMENTAL_STORAGE_HEATER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Night storage heater dust",
    "code": "ENVIRONMENTAL_NIGHT_STORAGE_HEATER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fan heater element dust",
    "code": "ENVIRONMENTAL_FAN_HEATER_ELEMENT_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Oil filled radiator dust",
    "code": "ENVIRONMENTAL_OIL_FILLED_RADIATOR_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Infrared heater dust",
    "code": "ENVIRONMENTAL_INFRARED_HEATER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Underfloor heating dust disturbance",
    "code": "ENVIRONMENTAL_UNDERFLOOR_HEATING_DUST_DISTURBANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Radiator sludge disturbance",
    "code": "ENVIRONMENTAL_RADIATOR_SLUDGE_DISTURBANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pipe lagging fibres",
    "code": "ENVIRONMENTAL_PIPE_LAGGING_FIBRES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Asbestos pipe lagging (historical)",
    "code": "ENVIRONMENTAL_ASBESTOS_PIPE_LAGGING_HISTORICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lead paint dust (historical)",
    "code": "ENVIRONMENTAL_LEAD_PAINT_DUST_HISTORICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Mercury spill vapour (historical)",
    "code": "ENVIRONMENTAL_MERCURY_SPILL_VAPOUR_HISTORICAL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Radon basement air",
    "code": "ENVIRONMENTAL_RADON_BASEMENT_AIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Methane basement trace",
    "code": "ENVIRONMENTAL_METHANE_BASEMENT_TRACE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carbon monoxide trace sensitivity",
    "code": "ENVIRONMENTAL_CARBON_MONOXIDE_TRACE_SENSITIVITY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ozone generator air",
    "code": "ENVIRONMENTAL_OZONE_GENERATOR_AIR",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ioniser air purifier ozone",
    "code": "ENVIRONMENTAL_IONISER_AIR_PURIFIER_OZONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "UV air purifier ozone",
    "code": "ENVIRONMENTAL_UV_AIR_PURIFIER_OZONE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Laser printer particle",
    "code": "ENVIRONMENTAL_LASER_PRINTER_PARTICLE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "3D pen plastic fumes",
    "code": "ENVIRONMENTAL_3D_PEN_PLASTIC_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Soldering iron flux smoke",
    "code": "ENVIRONMENTAL_SOLDERING_IRON_FLUX_SMOKE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hot glue gun fumes",
    "code": "ENVIRONMENTAL_HOT_GLUE_GUN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Superglue fumes",
    "code": "ENVIRONMENTAL_SUPERGLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Epoxy glue fumes",
    "code": "ENVIRONMENTAL_EPOXY_GLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Contact adhesive fumes",
    "code": "ENVIRONMENTAL_CONTACT_ADHESIVE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood glue fumes",
    "code": "ENVIRONMENTAL_WOOD_GLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "PVA glue fumes",
    "code": "ENVIRONMENTAL_PVA_GLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Carpet glue fumes",
    "code": "ENVIRONMENTAL_CARPET_GLUE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tile adhesive solvent",
    "code": "ENVIRONMENTAL_TILE_ADHESIVE_SOLVENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Flooring adhesive solvent",
    "code": "ENVIRONMENTAL_FLOORING_ADHESIVE_SOLVENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wallpaper paste mould spores",
    "code": "ENVIRONMENTAL_WALLPAPER_PASTE_MOULD_SPORES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wallpaper vinyl fumes",
    "code": "ENVIRONMENTAL_WALLPAPER_VINYL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Paint stripper fumes",
    "code": "ENVIRONMENTAL_PAINT_STRIPPER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Paint thinner fumes",
    "code": "ENVIRONMENTAL_PAINT_THINNER_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "White spirit fumes",
    "code": "ENVIRONMENTAL_WHITE_SPIRIT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Turpentine fumes",
    "code": "ENVIRONMENTAL_TURPENTINE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Linseed oil fumes",
    "code": "ENVIRONMENTAL_LINSEED_OIL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Danish oil fumes",
    "code": "ENVIRONMENTAL_DANISH_OIL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Teak oil fumes",
    "code": "ENVIRONMENTAL_TEAK_OIL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood stain fumes",
    "code": "ENVIRONMENTAL_WOOD_STAIN_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wood dye fumes",
    "code": "ENVIRONMENTAL_WOOD_DYE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Varnish polyurethane fumes",
    "code": "ENVIRONMENTAL_VARNISH_POLYURETHANE_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shellac fumes",
    "code": "ENVIRONMENTAL_SHELLAC_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "French polish fumes",
    "code": "ENVIRONMENTAL_FRENCH_POLISH_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Lacquer spray fumes",
    "code": "ENVIRONMENTAL_LACQUER_SPRAY_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Car spray paint fumes",
    "code": "ENVIRONMENTAL_CAR_SPRAY_PAINT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Graffiti paint fumes",
    "code": "ENVIRONMENTAL_GRAFFITI_PAINT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Road marking paint fumes",
    "code": "ENVIRONMENTAL_ROAD_MARKING_PAINT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Thermoplastic road marking fumes",
    "code": "ENVIRONMENTAL_THERMOPLASTIC_ROAD_MARKING_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Playground paint fumes",
    "code": "ENVIRONMENTAL_PLAYGROUND_PAINT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "School gym floor varnish",
    "code": "ENVIRONMENTAL_SCHOOL_GYM_FLOOR_VARNISH",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Sports hall floor sealant",
    "code": "ENVIRONMENTAL_SPORTS_HALL_FLOOR_SEALANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ice rink ammonia refrigeration leak",
    "code": "ENVIRONMENTAL_ICE_RINK_AMMONIA_REFRIGERATION_LEAK",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Ice rink Zamboni exhaust",
    "code": "ENVIRONMENTAL_ICE_RINK_ZAMBONI_EXHAUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bowling alley lane oil",
    "code": "ENVIRONMENTAL_BOWLING_ALLEY_LANE_OIL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Snooker table cloth dust",
    "code": "ENVIRONMENTAL_SNOOKER_TABLE_CLOTH_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pool table felt dust",
    "code": "ENVIRONMENTAL_POOL_TABLE_FELT_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Darts chalk dust",
    "code": "ENVIRONMENTAL_DARTS_CHALK_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Archery target straw dust",
    "code": "ENVIRONMENTAL_ARCHERY_TARGET_STRAW_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Clay pigeon dust",
    "code": "ENVIRONMENTAL_CLAY_PIGEON_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Shooting range lead dust",
    "code": "ENVIRONMENTAL_SHOOTING_RANGE_LEAD_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gun oil fumes",
    "code": "ENVIRONMENTAL_GUN_OIL_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cleaning rod solvent",
    "code": "ENVIRONMENTAL_CLEANING_ROD_SOLVENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fishing bait mould",
    "code": "ENVIRONMENTAL_FISHING_BAIT_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fishing tackle rubber worms",
    "code": "ENVIRONMENTAL_FISHING_TACKLE_RUBBER_WORMS",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Waders neoprene",
    "code": "ENVIRONMENTAL_WADERS_NEOPRENE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Wellington boot rubber",
    "code": "ENVIRONMENTAL_WELLINGTON_BOOT_RUBBER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Gardening gloves latex",
    "code": "ENVIRONMENTAL_GARDENING_GLOVES_LATEX",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pruning sealant fumes",
    "code": "ENVIRONMENTAL_PRUNING_SEALANT_FUMES",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Tree wound paint",
    "code": "ENVIRONMENTAL_TREE_WOUND_PAINT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Horticultural oil spray",
    "code": "ENVIRONMENTAL_HORTICULTURAL_OIL_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dormant oil spray",
    "code": "ENVIRONMENTAL_DORMANT_OIL_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Fungicide garden spray",
    "code": "ENVIRONMENTAL_FUNGICIDE_GARDEN_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Insecticide garden spray",
    "code": "ENVIRONMENTAL_INSECTICIDE_GARDEN_SPRAY",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Slug pellet dust",
    "code": "ENVIRONMENTAL_SLUG_PELLET_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rat poison bait dust",
    "code": "ENVIRONMENTAL_RAT_POISON_BAIT_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bird feeder mould",
    "code": "ENVIRONMENTAL_BIRD_FEEDER_MOULD",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Chicken coop dust",
    "code": "ENVIRONMENTAL_CHICKEN_COOP_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Rabbit hutch ammonia",
    "code": "ENVIRONMENTAL_RABBIT_HUTCH_AMMONIA",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Guinea pig hay dust",
    "code": "ENVIRONMENTAL_GUINEA_PIG_HAY_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Hamster bedding dust",
    "code": "ENVIRONMENTAL_HAMSTER_BEDDING_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Cat litter dust",
    "code": "ENVIRONMENTAL_CAT_LITTER_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Dog shampoo fragrance",
    "code": "ENVIRONMENTAL_DOG_SHAMPOO_FRAGRANCE",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Pet flea treatment",
    "code": "ENVIRONMENTAL_PET_FLEA_TREATMENT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Horse stable dust",
    "code": "ENVIRONMENTAL_HORSE_STABLE_DUST",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Riding hat padding",
    "code": "ENVIRONMENTAL_RIDING_HAT_PADDING",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Saddle leather",
    "code": "ENVIRONMENTAL_SADDLE_LEATHER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Bridle leather",
    "code": "ENVIRONMENTAL_BRIDLE_LEATHER",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Horse blanket wool",
    "code": "ENVIRONMENTAL_HORSE_BLANKET_WOOL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Stable disinfectant",
    "code": "ENVIRONMENTAL_STABLE_DISINFECTANT",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Farrier hoof oil",
    "code": "ENVIRONMENTAL_FARRIER_HOOF_OIL",
    "category": "ENVIRONMENTAL"
  },
  {
    "name": "Penicillin",
    "code": "MEDICATION_PENICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Amoxicillin",
    "code": "MEDICATION_AMOXICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ampicillin",
    "code": "MEDICATION_AMPICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Flucloxacillin",
    "code": "MEDICATION_FLUCLOXACILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Piperacillin",
    "code": "MEDICATION_PIPERACILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Cefalexin / cephalosporins",
    "code": "MEDICATION_CEFALEXIN_CEPHALOSPORINS",
    "category": "MEDICATION"
  },
  {
    "name": "Cefuroxime",
    "code": "MEDICATION_CEFUROXIME",
    "category": "MEDICATION"
  },
  {
    "name": "Ceftriaxone",
    "code": "MEDICATION_CEFTRIAXONE",
    "category": "MEDICATION"
  },
  {
    "name": "Cefazolin",
    "code": "MEDICATION_CEFAZOLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Erythromycin / macrolides",
    "code": "MEDICATION_ERYTHROMYCIN_MACROLIDES",
    "category": "MEDICATION"
  },
  {
    "name": "Azithromycin",
    "code": "MEDICATION_AZITHROMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Clarithromycin",
    "code": "MEDICATION_CLARITHROMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Clindamycin",
    "code": "MEDICATION_CLINDAMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Vancomycin",
    "code": "MEDICATION_VANCOMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Gentamicin",
    "code": "MEDICATION_GENTAMICIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ciprofloxacin",
    "code": "MEDICATION_CIPROFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Levofloxacin",
    "code": "MEDICATION_LEVOFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Moxifloxacin",
    "code": "MEDICATION_MOXIFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Doxycycline",
    "code": "MEDICATION_DOXYCYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Minocycline",
    "code": "MEDICATION_MINOCYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Tetracycline",
    "code": "MEDICATION_TETRACYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Metronidazole",
    "code": "MEDICATION_METRONIDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Nitrofurantoin",
    "code": "MEDICATION_NITROFURANTOIN",
    "category": "MEDICATION"
  },
  {
    "name": "Trimethoprim",
    "code": "MEDICATION_TRIMETHOPRIM",
    "category": "MEDICATION"
  },
  {
    "name": "Sulfa / sulphonamide drugs",
    "code": "MEDICATION_SULFA_SULPHONAMIDE_DRUGS",
    "category": "MEDICATION"
  },
  {
    "name": "Co-trimoxazole",
    "code": "MEDICATION_CO_TRIMOXAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Aspirin",
    "code": "MEDICATION_ASPIRIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ibuprofen / NSAIDs",
    "code": "MEDICATION_IBUPROFEN_NSAIDS",
    "category": "MEDICATION"
  },
  {
    "name": "Naproxen",
    "code": "MEDICATION_NAPROXEN",
    "category": "MEDICATION"
  },
  {
    "name": "Diclofenac",
    "code": "MEDICATION_DICLOFENAC",
    "category": "MEDICATION"
  },
  {
    "name": "Celecoxib",
    "code": "MEDICATION_CELECOXIB",
    "category": "MEDICATION"
  },
  {
    "name": "Meloxicam",
    "code": "MEDICATION_MELOXICAM",
    "category": "MEDICATION"
  },
  {
    "name": "Indometacin",
    "code": "MEDICATION_INDOMETACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ketorolac",
    "code": "MEDICATION_KETOROLAC",
    "category": "MEDICATION"
  },
  {
    "name": "Codeine",
    "code": "MEDICATION_CODEINE",
    "category": "MEDICATION"
  },
  {
    "name": "Morphine / opioids",
    "code": "MEDICATION_MORPHINE_OPIOIDS",
    "category": "MEDICATION"
  },
  {
    "name": "Tramadol",
    "code": "MEDICATION_TRAMADOL",
    "category": "MEDICATION"
  },
  {
    "name": "Fentanyl",
    "code": "MEDICATION_FENTANYL",
    "category": "MEDICATION"
  },
  {
    "name": "Oxycodone",
    "code": "MEDICATION_OXYCODONE",
    "category": "MEDICATION"
  },
  {
    "name": "Hydrocodone",
    "code": "MEDICATION_HYDROCODONE",
    "category": "MEDICATION"
  },
  {
    "name": "Methadone",
    "code": "MEDICATION_METHADONE",
    "category": "MEDICATION"
  },
  {
    "name": "Buprenorphine",
    "code": "MEDICATION_BUPRENORPHINE",
    "category": "MEDICATION"
  },
  {
    "name": "Local anaesthetic (lidocaine)",
    "code": "MEDICATION_LOCAL_ANAESTHETIC_LIDOCAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Bupivacaine",
    "code": "MEDICATION_BUPIVACAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Procaine",
    "code": "MEDICATION_PROCAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Articaine",
    "code": "MEDICATION_ARTICAINE",
    "category": "MEDICATION"
  },
  {
    "name": "General anaesthetic",
    "code": "MEDICATION_GENERAL_ANAESTHETIC",
    "category": "MEDICATION"
  },
  {
    "name": "Propofol",
    "code": "MEDICATION_PROPOFOL",
    "category": "MEDICATION"
  },
  {
    "name": "Ketamine",
    "code": "MEDICATION_KETAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Sevoflurane",
    "code": "MEDICATION_SEVOFLURANE",
    "category": "MEDICATION"
  },
  {
    "name": "Insulin",
    "code": "MEDICATION_INSULIN",
    "category": "MEDICATION"
  },
  {
    "name": "Iodine / contrast dye",
    "code": "MEDICATION_IODINE_CONTRAST_DYE",
    "category": "MEDICATION"
  },
  {
    "name": "Iohexol contrast",
    "code": "MEDICATION_IOHEXOL_CONTRAST",
    "category": "MEDICATION"
  },
  {
    "name": "Gadolinium contrast",
    "code": "MEDICATION_GADOLINIUM_CONTRAST",
    "category": "MEDICATION"
  },
  {
    "name": "ACE inhibitors",
    "code": "MEDICATION_ACE_INHIBITORS",
    "category": "MEDICATION"
  },
  {
    "name": "Ramipril",
    "code": "MEDICATION_RAMIPRIL",
    "category": "MEDICATION"
  },
  {
    "name": "Lisinopril",
    "code": "MEDICATION_LISINOPRIL",
    "category": "MEDICATION"
  },
  {
    "name": "Enalapril",
    "code": "MEDICATION_ENALAPRIL",
    "category": "MEDICATION"
  },
  {
    "name": "Perindopril",
    "code": "MEDICATION_PERINDOPRIL",
    "category": "MEDICATION"
  },
  {
    "name": "Beta blockers",
    "code": "MEDICATION_BETA_BLOCKERS",
    "category": "MEDICATION"
  },
  {
    "name": "Propranolol",
    "code": "MEDICATION_PROPRANOLOL",
    "category": "MEDICATION"
  },
  {
    "name": "Atenolol",
    "code": "MEDICATION_ATENOLOL",
    "category": "MEDICATION"
  },
  {
    "name": "Bisoprolol",
    "code": "MEDICATION_BISOPROLOL",
    "category": "MEDICATION"
  },
  {
    "name": "Metoprolol",
    "code": "MEDICATION_METOPROLOL",
    "category": "MEDICATION"
  },
  {
    "name": "Metformin",
    "code": "MEDICATION_METFORMIN",
    "category": "MEDICATION"
  },
  {
    "name": "Atorvastatin / statins",
    "code": "MEDICATION_ATORVASTATIN_STATINS",
    "category": "MEDICATION"
  },
  {
    "name": "Simvastatin",
    "code": "MEDICATION_SIMVASTATIN",
    "category": "MEDICATION"
  },
  {
    "name": "Rosuvastatin",
    "code": "MEDICATION_ROSUVASTATIN",
    "category": "MEDICATION"
  },
  {
    "name": "Pravastatin",
    "code": "MEDICATION_PRAVASTATIN",
    "category": "MEDICATION"
  },
  {
    "name": "Vaccines (egg protein)",
    "code": "MEDICATION_VACCINES_EGG_PROTEIN",
    "category": "MEDICATION"
  },
  {
    "name": "Vaccines (gelatin)",
    "code": "MEDICATION_VACCINES_GELATIN",
    "category": "MEDICATION"
  },
  {
    "name": "MMR vaccine",
    "code": "MEDICATION_MMR_VACCINE",
    "category": "MEDICATION"
  },
  {
    "name": "Flu vaccine",
    "code": "MEDICATION_FLU_VACCINE",
    "category": "MEDICATION"
  },
  {
    "name": "COVID-19 vaccine",
    "code": "MEDICATION_COVID_19_VACCINE",
    "category": "MEDICATION"
  },
  {
    "name": "Heparin",
    "code": "MEDICATION_HEPARIN",
    "category": "MEDICATION"
  },
  {
    "name": "Low molecular weight heparin",
    "code": "MEDICATION_LOW_MOLECULAR_WEIGHT_HEPARIN",
    "category": "MEDICATION"
  },
  {
    "name": "Warfarin",
    "code": "MEDICATION_WARFARIN",
    "category": "MEDICATION"
  },
  {
    "name": "Apixaban",
    "code": "MEDICATION_APIXABAN",
    "category": "MEDICATION"
  },
  {
    "name": "Rivaroxaban",
    "code": "MEDICATION_RIVAROXABAN",
    "category": "MEDICATION"
  },
  {
    "name": "Paracetamol",
    "code": "MEDICATION_PARACETAMOL",
    "category": "MEDICATION"
  },
  {
    "name": "Paracetamol-codeine",
    "code": "MEDICATION_PARACETAMOL_CODEINE",
    "category": "MEDICATION"
  },
  {
    "name": "Amitriptyline",
    "code": "MEDICATION_AMITRIPTYLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Sertraline",
    "code": "MEDICATION_SERTRALINE",
    "category": "MEDICATION"
  },
  {
    "name": "Fluoxetine",
    "code": "MEDICATION_FLUOXETINE",
    "category": "MEDICATION"
  },
  {
    "name": "Citalopram",
    "code": "MEDICATION_CITALOPRAM",
    "category": "MEDICATION"
  },
  {
    "name": "Venlafaxine",
    "code": "MEDICATION_VENLAFAXINE",
    "category": "MEDICATION"
  },
  {
    "name": "Mirtazapine",
    "code": "MEDICATION_MIRTAZAPINE",
    "category": "MEDICATION"
  },
  {
    "name": "Lithium",
    "code": "MEDICATION_LITHIUM",
    "category": "MEDICATION"
  },
  {
    "name": "Carbamazepine",
    "code": "MEDICATION_CARBAMAZEPINE",
    "category": "MEDICATION"
  },
  {
    "name": "Phenytoin",
    "code": "MEDICATION_PHENYTOIN",
    "category": "MEDICATION"
  },
  {
    "name": "Lamotrigine",
    "code": "MEDICATION_LAMOTRIGINE",
    "category": "MEDICATION"
  },
  {
    "name": "Valproate",
    "code": "MEDICATION_VALPROATE",
    "category": "MEDICATION"
  },
  {
    "name": "Levetiracetam",
    "code": "MEDICATION_LEVETIRACETAM",
    "category": "MEDICATION"
  },
  {
    "name": "Gabapentin",
    "code": "MEDICATION_GABAPENTIN",
    "category": "MEDICATION"
  },
  {
    "name": "Pregabalin",
    "code": "MEDICATION_PREGABALIN",
    "category": "MEDICATION"
  },
  {
    "name": "Diazepam",
    "code": "MEDICATION_DIAZEPAM",
    "category": "MEDICATION"
  },
  {
    "name": "Lorazepam",
    "code": "MEDICATION_LORAZEPAM",
    "category": "MEDICATION"
  },
  {
    "name": "Midazolam",
    "code": "MEDICATION_MIDAZOLAM",
    "category": "MEDICATION"
  },
  {
    "name": "Zopiclone",
    "code": "MEDICATION_ZOPICLONE",
    "category": "MEDICATION"
  },
  {
    "name": "Zolpidem",
    "code": "MEDICATION_ZOLPIDEM",
    "category": "MEDICATION"
  },
  {
    "name": "Prednisolone",
    "code": "MEDICATION_PREDNISOLONE",
    "category": "MEDICATION"
  },
  {
    "name": "Hydrocortisone",
    "code": "MEDICATION_HYDROCORTISONE",
    "category": "MEDICATION"
  },
  {
    "name": "Dexamethasone",
    "code": "MEDICATION_DEXAMETHASONE",
    "category": "MEDICATION"
  },
  {
    "name": "Salbutamol inhaler",
    "code": "MEDICATION_SALBUTAMOL_INHALER",
    "category": "MEDICATION"
  },
  {
    "name": "Beclometasone inhaler",
    "code": "MEDICATION_BECLOMETASONE_INHALER",
    "category": "MEDICATION"
  },
  {
    "name": "Fluticasone inhaler",
    "code": "MEDICATION_FLUTICASONE_INHALER",
    "category": "MEDICATION"
  },
  {
    "name": "Montelukast",
    "code": "MEDICATION_MONTELUKAST",
    "category": "MEDICATION"
  },
  {
    "name": "Theophylline",
    "code": "MEDICATION_THEOPHYLLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Antihistamine (cetirizine)",
    "code": "MEDICATION_ANTIHISTAMINE_CETIRIZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Antihistamine (loratadine)",
    "code": "MEDICATION_ANTIHISTAMINE_LORATADINE",
    "category": "MEDICATION"
  },
  {
    "name": "Antihistamine (chlorphenamine)",
    "code": "MEDICATION_ANTIHISTAMINE_CHLORPHENAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Antihistamine (fexofenadine)",
    "code": "MEDICATION_ANTIHISTAMINE_FEXOFENADINE",
    "category": "MEDICATION"
  },
  {
    "name": "Chlorhexidine",
    "code": "MEDICATION_CHLORHEXIDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Povidone-iodine",
    "code": "MEDICATION_POVIDONE_IODINE",
    "category": "MEDICATION"
  },
  {
    "name": "Neomycin (topical)",
    "code": "MEDICATION_NEOMYCIN_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Bacitracin (topical)",
    "code": "MEDICATION_BACITRACIN_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Fusidic acid",
    "code": "MEDICATION_FUSIDIC_ACID",
    "category": "MEDICATION"
  },
  {
    "name": "Mupirocin",
    "code": "MEDICATION_MUPIROCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Hydrocortisone cream",
    "code": "MEDICATION_HYDROCORTISONE_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Betamethasone cream",
    "code": "MEDICATION_BETAMETHASONE_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Tacrolimus ointment",
    "code": "MEDICATION_TACROLIMUS_OINTMENT",
    "category": "MEDICATION"
  },
  {
    "name": "Pimecrolimus cream",
    "code": "MEDICATION_PIMECROLIMUS_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Eye drops (chloramphenicol)",
    "code": "MEDICATION_EYE_DROPS_CHLORAMPHENICOL",
    "category": "MEDICATION"
  },
  {
    "name": "Ear drops",
    "code": "MEDICATION_EAR_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Nystatin",
    "code": "MEDICATION_NYSTATIN",
    "category": "MEDICATION"
  },
  {
    "name": "Fluconazole",
    "code": "MEDICATION_FLUCONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Aciclovir",
    "code": "MEDICATION_ACICLOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Valaciclovir",
    "code": "MEDICATION_VALACICLOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Oseltamivir",
    "code": "MEDICATION_OSELTAMIVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Methotrexate",
    "code": "MEDICATION_METHOTREXATE",
    "category": "MEDICATION"
  },
  {
    "name": "Azathioprine",
    "code": "MEDICATION_AZATHIOPRINE",
    "category": "MEDICATION"
  },
  {
    "name": "Mycophenolate",
    "code": "MEDICATION_MYCOPHENOLATE",
    "category": "MEDICATION"
  },
  {
    "name": "Cyclosporin",
    "code": "MEDICATION_CYCLOSPORIN",
    "category": "MEDICATION"
  },
  {
    "name": "Tacrolimus (oral)",
    "code": "MEDICATION_TACROLIMUS_ORAL",
    "category": "MEDICATION"
  },
  {
    "name": "Infliximab",
    "code": "MEDICATION_INFLIXIMAB",
    "category": "MEDICATION"
  },
  {
    "name": "Adalimumab",
    "code": "MEDICATION_ADALIMUMAB",
    "category": "MEDICATION"
  },
  {
    "name": "Etanercept",
    "code": "MEDICATION_ETANERCEPT",
    "category": "MEDICATION"
  },
  {
    "name": "Rituximab",
    "code": "MEDICATION_RITUXIMAB",
    "category": "MEDICATION"
  },
  {
    "name": "Pembrolizumab",
    "code": "MEDICATION_PEMBROLIZUMAB",
    "category": "MEDICATION"
  },
  {
    "name": "Chemotherapy (platinum)",
    "code": "MEDICATION_CHEMOTHERAPY_PLATINUM",
    "category": "MEDICATION"
  },
  {
    "name": "Chemotherapy (taxanes)",
    "code": "MEDICATION_CHEMOTHERAPY_TAXANES",
    "category": "MEDICATION"
  },
  {
    "name": "Chemotherapy (anthracyclines)",
    "code": "MEDICATION_CHEMOTHERAPY_ANTHRACYCLINES",
    "category": "MEDICATION"
  },
  {
    "name": "Allopurinol",
    "code": "MEDICATION_ALLOPURINOL",
    "category": "MEDICATION"
  },
  {
    "name": "Colchicine",
    "code": "MEDICATION_COLCHICINE",
    "category": "MEDICATION"
  },
  {
    "name": "Febuxostat",
    "code": "MEDICATION_FEBUXOSTAT",
    "category": "MEDICATION"
  },
  {
    "name": "Levothyroxine",
    "code": "MEDICATION_LEVOTHYROXINE",
    "category": "MEDICATION"
  },
  {
    "name": "Carbimazole",
    "code": "MEDICATION_CARBIMAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Propylthiouracil",
    "code": "MEDICATION_PROPYLTHIOURACIL",
    "category": "MEDICATION"
  },
  {
    "name": "Digoxin",
    "code": "MEDICATION_DIGOXIN",
    "category": "MEDICATION"
  },
  {
    "name": "Amiodarone",
    "code": "MEDICATION_AMIODARONE",
    "category": "MEDICATION"
  },
  {
    "name": "Amlodipine",
    "code": "MEDICATION_AMLODIPINE",
    "category": "MEDICATION"
  },
  {
    "name": "Nifedipine",
    "code": "MEDICATION_NIFEDIPINE",
    "category": "MEDICATION"
  },
  {
    "name": "Diltiazem",
    "code": "MEDICATION_DILTIAZEM",
    "category": "MEDICATION"
  },
  {
    "name": "Verapamil",
    "code": "MEDICATION_VERAPAMIL",
    "category": "MEDICATION"
  },
  {
    "name": "Furosemide",
    "code": "MEDICATION_FUROSEMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Bendroflumethiazide",
    "code": "MEDICATION_BENDROFLUMETHIAZIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Spironolactone",
    "code": "MEDICATION_SPIRONOLACTONE",
    "category": "MEDICATION"
  },
  {
    "name": "Sitagliptin",
    "code": "MEDICATION_SITAGLIPTIN",
    "category": "MEDICATION"
  },
  {
    "name": "Gliclazide",
    "code": "MEDICATION_GLICLAZIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Glipizide",
    "code": "MEDICATION_GLIPIZIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Empagliflozin",
    "code": "MEDICATION_EMPAGLIFLOZIN",
    "category": "MEDICATION"
  },
  {
    "name": "Semaglutide",
    "code": "MEDICATION_SEMAGLUTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Liraglutide",
    "code": "MEDICATION_LIRAGLUTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Orlistat",
    "code": "MEDICATION_ORLISTAT",
    "category": "MEDICATION"
  },
  {
    "name": "Domperidone",
    "code": "MEDICATION_DOMPERIDONE",
    "category": "MEDICATION"
  },
  {
    "name": "Metoclopramide",
    "code": "MEDICATION_METOCLOPRAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Ondansetron",
    "code": "MEDICATION_ONDANSETRON",
    "category": "MEDICATION"
  },
  {
    "name": "Cyclizine",
    "code": "MEDICATION_CYCLIZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Hyoscine",
    "code": "MEDICATION_HYOSCINE",
    "category": "MEDICATION"
  },
  {
    "name": "Loperamide",
    "code": "MEDICATION_LOPERAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Senna laxative",
    "code": "MEDICATION_SENNA_LAXATIVE",
    "category": "MEDICATION"
  },
  {
    "name": "Lactulose",
    "code": "MEDICATION_LACTULOSE",
    "category": "MEDICATION"
  },
  {
    "name": "Macrogol laxative",
    "code": "MEDICATION_MACROGOL_LAXATIVE",
    "category": "MEDICATION"
  },
  {
    "name": "Omeprazole",
    "code": "MEDICATION_OMEPRAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Lansoprazole",
    "code": "MEDICATION_LANSOPRAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Gaviscon",
    "code": "MEDICATION_GAVISCON",
    "category": "MEDICATION"
  },
  {
    "name": "Simeticone",
    "code": "MEDICATION_SIMETICONE",
    "category": "MEDICATION"
  },
  {
    "name": "Mesalazine",
    "code": "MEDICATION_MESALAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Sulfasalazine",
    "code": "MEDICATION_SULFASALAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Iron tablets",
    "code": "MEDICATION_IRON_TABLETS",
    "category": "MEDICATION"
  },
  {
    "name": "Ferrous sulphate",
    "code": "MEDICATION_FERROUS_SULPHATE",
    "category": "MEDICATION"
  },
  {
    "name": "Vitamin B12 injection",
    "code": "MEDICATION_VITAMIN_B12_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Folic acid",
    "code": "MEDICATION_FOLIC_ACID",
    "category": "MEDICATION"
  },
  {
    "name": "Calcium supplements",
    "code": "MEDICATION_CALCIUM_SUPPLEMENTS",
    "category": "MEDICATION"
  },
  {
    "name": "Vitamin D supplements",
    "code": "MEDICATION_VITAMIN_D_SUPPLEMENTS",
    "category": "MEDICATION"
  },
  {
    "name": "Potassium chloride",
    "code": "MEDICATION_POTASSIUM_CHLORIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Magnesium supplements",
    "code": "MEDICATION_MAGNESIUM_SUPPLEMENTS",
    "category": "MEDICATION"
  },
  {
    "name": "Zinc supplements",
    "code": "MEDICATION_ZINC_SUPPLEMENTS",
    "category": "MEDICATION"
  },
  {
    "name": "Fish oil capsules",
    "code": "MEDICATION_FISH_OIL_CAPSULES",
    "category": "MEDICATION"
  },
  {
    "name": "Glucosamine",
    "code": "MEDICATION_GLUCOSAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Chondroitin",
    "code": "MEDICATION_CHONDROITIN",
    "category": "MEDICATION"
  },
  {
    "name": "St Johns wort",
    "code": "MEDICATION_ST_JOHNS_WORT",
    "category": "MEDICATION"
  },
  {
    "name": "Echinacea",
    "code": "MEDICATION_ECHINACEA",
    "category": "MEDICATION"
  },
  {
    "name": "Probiotics capsules",
    "code": "MEDICATION_PROBIOTICS_CAPSULES",
    "category": "MEDICATION"
  },
  {
    "name": "Lactase enzyme",
    "code": "MEDICATION_LACTASE_ENZYME",
    "category": "MEDICATION"
  },
  {
    "name": "Pancreatin",
    "code": "MEDICATION_PANCREATIN",
    "category": "MEDICATION"
  },
  {
    "name": "Quinine tablets",
    "code": "MEDICATION_QUININE_TABLETS",
    "category": "MEDICATION"
  },
  {
    "name": "Hydroxychloroquine",
    "code": "MEDICATION_HYDROXYCHLOROQUINE",
    "category": "MEDICATION"
  },
  {
    "name": "Chloroquine",
    "code": "MEDICATION_CHLOROQUINE",
    "category": "MEDICATION"
  },
  {
    "name": "Gold injections",
    "code": "MEDICATION_GOLD_INJECTIONS",
    "category": "MEDICATION"
  },
  {
    "name": "Penicillamine",
    "code": "MEDICATION_PENICILLAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Cefixime",
    "code": "MEDICATION_CEFIXIME",
    "category": "MEDICATION"
  },
  {
    "name": "Cefpodoxime",
    "code": "MEDICATION_CEFPODOXIME",
    "category": "MEDICATION"
  },
  {
    "name": "Ceftazidime",
    "code": "MEDICATION_CEFTAZIDIME",
    "category": "MEDICATION"
  },
  {
    "name": "Cefepime",
    "code": "MEDICATION_CEFEPIME",
    "category": "MEDICATION"
  },
  {
    "name": "Meropenem",
    "code": "MEDICATION_MEROPENEM",
    "category": "MEDICATION"
  },
  {
    "name": "Imipenem",
    "code": "MEDICATION_IMIPENEM",
    "category": "MEDICATION"
  },
  {
    "name": "Ertapenem",
    "code": "MEDICATION_ERTAPENEM",
    "category": "MEDICATION"
  },
  {
    "name": "Aztreonam",
    "code": "MEDICATION_AZTREONAM",
    "category": "MEDICATION"
  },
  {
    "name": "Linezolid",
    "code": "MEDICATION_LINEZOLID",
    "category": "MEDICATION"
  },
  {
    "name": "Daptomycin",
    "code": "MEDICATION_DAPTOMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Tigecycline",
    "code": "MEDICATION_TIGECYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Fosfomycin",
    "code": "MEDICATION_FOSFOMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Fidaxomicin",
    "code": "MEDICATION_FIDAXOMICIN",
    "category": "MEDICATION"
  },
  {
    "name": "Rifampicin",
    "code": "MEDICATION_RIFAMPICIN",
    "category": "MEDICATION"
  },
  {
    "name": "Isoniazid",
    "code": "MEDICATION_ISONIAZID",
    "category": "MEDICATION"
  },
  {
    "name": "Pyrazinamide",
    "code": "MEDICATION_PYRAZINAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Ethambutol",
    "code": "MEDICATION_ETHAMBUTOL",
    "category": "MEDICATION"
  },
  {
    "name": "Bedaquiline",
    "code": "MEDICATION_BEDAQUILINE",
    "category": "MEDICATION"
  },
  {
    "name": "Delamanid",
    "code": "MEDICATION_DELAMANID",
    "category": "MEDICATION"
  },
  {
    "name": "Clarithromycin TB",
    "code": "MEDICATION_CLARITHROMYCIN_TB",
    "category": "MEDICATION"
  },
  {
    "name": "Streptomycin",
    "code": "MEDICATION_STREPTOMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Amikacin",
    "code": "MEDICATION_AMIKACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Tobramycin",
    "code": "MEDICATION_TOBRAMYCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Colistin",
    "code": "MEDICATION_COLISTIN",
    "category": "MEDICATION"
  },
  {
    "name": "Polymyxin B",
    "code": "MEDICATION_POLYMYXIN_B",
    "category": "MEDICATION"
  },
  {
    "name": "Fosfomycin UTI",
    "code": "MEDICATION_FOSFOMYCIN_UTI",
    "category": "MEDICATION"
  },
  {
    "name": "Nitrofurantoin macro",
    "code": "MEDICATION_NITROFURANTOIN_MACRO",
    "category": "MEDICATION"
  },
  {
    "name": "Pivmecillinam",
    "code": "MEDICATION_PIVMECILLINAM",
    "category": "MEDICATION"
  },
  {
    "name": "Fosfomycin sachet",
    "code": "MEDICATION_FOSFOMYCIN_SACHET",
    "category": "MEDICATION"
  },
  {
    "name": "Methenamine",
    "code": "MEDICATION_METHENAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Cranberry extract tablets",
    "code": "MEDICATION_CRANBERRY_EXTRACT_TABLETS",
    "category": "MEDICATION"
  },
  {
    "name": "D-mannose supplement",
    "code": "MEDICATION_D_MANNOSE_SUPPLEMENT",
    "category": "MEDICATION"
  },
  {
    "name": "Phenoxymethylpenicillin",
    "code": "MEDICATION_PHENOXYMETHYLPENICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Benzathine penicillin",
    "code": "MEDICATION_BENZATHINE_PENICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Procaine penicillin",
    "code": "MEDICATION_PROCAINE_PENICILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ticarcillin",
    "code": "MEDICATION_TICARCILLIN",
    "category": "MEDICATION"
  },
  {
    "name": "Piperacillin-tazobactam",
    "code": "MEDICATION_PIPERACILLIN_TAZOBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Ampicillin-sulbactam",
    "code": "MEDICATION_AMPICILLIN_SULBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Amoxicillin-clavulanate",
    "code": "MEDICATION_AMOXICILLIN_CLAVULANATE",
    "category": "MEDICATION"
  },
  {
    "name": "Cefaclor",
    "code": "MEDICATION_CEFACLOR",
    "category": "MEDICATION"
  },
  {
    "name": "Cefadroxil",
    "code": "MEDICATION_CEFADROXIL",
    "category": "MEDICATION"
  },
  {
    "name": "Cefdinir",
    "code": "MEDICATION_CEFDINIR",
    "category": "MEDICATION"
  },
  {
    "name": "Cefditoren",
    "code": "MEDICATION_CEFDITOREN",
    "category": "MEDICATION"
  },
  {
    "name": "Cefotaxime",
    "code": "MEDICATION_CEFOTAXIME",
    "category": "MEDICATION"
  },
  {
    "name": "Cefoxitin",
    "code": "MEDICATION_CEFOXITIN",
    "category": "MEDICATION"
  },
  {
    "name": "Cefprozil",
    "code": "MEDICATION_CEFPROZIL",
    "category": "MEDICATION"
  },
  {
    "name": "Ceftaroline",
    "code": "MEDICATION_CEFTAROLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Cefuroxime axetil",
    "code": "MEDICATION_CEFUROXIME_AXETIL",
    "category": "MEDICATION"
  },
  {
    "name": "Cephalexin monohydrate",
    "code": "MEDICATION_CEPHALEXIN_MONOHYDRATE",
    "category": "MEDICATION"
  },
  {
    "name": "Meropenem-vaborbactam",
    "code": "MEDICATION_MEROPENEM_VABORBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Ceftolozane-tazobactam",
    "code": "MEDICATION_CEFTOLOZANE_TAZOBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Ceftazidime-avibactam",
    "code": "MEDICATION_CEFTAZIDIME_AVIBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Aztreonam avibactam",
    "code": "MEDICATION_AZTREONAM_AVIBACTAM",
    "category": "MEDICATION"
  },
  {
    "name": "Telavancin",
    "code": "MEDICATION_TELAVANCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Dalbavancin",
    "code": "MEDICATION_DALBAVANCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Oritavancin",
    "code": "MEDICATION_ORITAVANCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Tedizolid",
    "code": "MEDICATION_TEDIZOLID",
    "category": "MEDICATION"
  },
  {
    "name": "Delafloxacin",
    "code": "MEDICATION_DELAFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Besifloxacin",
    "code": "MEDICATION_BESIFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Moxifloxacin eye",
    "code": "MEDICATION_MOXIFLOXACIN_EYE",
    "category": "MEDICATION"
  },
  {
    "name": "Ofloxacin",
    "code": "MEDICATION_OFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Norfloxacin",
    "code": "MEDICATION_NORFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Gemifloxacin",
    "code": "MEDICATION_GEMIFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Prulifloxacin",
    "code": "MEDICATION_PRULIFLOXACIN",
    "category": "MEDICATION"
  },
  {
    "name": "Rifaximin",
    "code": "MEDICATION_RIFAXIMIN",
    "category": "MEDICATION"
  },
  {
    "name": "Fidaxomicin repeat",
    "code": "MEDICATION_FIDAXOMICIN_REPEAT",
    "category": "MEDICATION"
  },
  {
    "name": "Vancomycin oral",
    "code": "MEDICATION_VANCOMYCIN_ORAL",
    "category": "MEDICATION"
  },
  {
    "name": "Teicoplanin",
    "code": "MEDICATION_TEICOPLANIN",
    "category": "MEDICATION"
  },
  {
    "name": "Fosfomycin IV",
    "code": "MEDICATION_FOSFOMYCIN_IV",
    "category": "MEDICATION"
  },
  {
    "name": "Chloramphenicol",
    "code": "MEDICATION_CHLORAMPHENICOL",
    "category": "MEDICATION"
  },
  {
    "name": "Clindamycin topical",
    "code": "MEDICATION_CLINDAMYCIN_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Erythromycin topical",
    "code": "MEDICATION_ERYTHROMYCIN_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Mupirocin nasal",
    "code": "MEDICATION_MUPIROCIN_NASAL",
    "category": "MEDICATION"
  },
  {
    "name": "Fusidic acid oral",
    "code": "MEDICATION_FUSIDIC_ACID_ORAL",
    "category": "MEDICATION"
  },
  {
    "name": "Rifampicin MRSA",
    "code": "MEDICATION_RIFAMPICIN_MRSA",
    "category": "MEDICATION"
  },
  {
    "name": "Doxycycline malaria",
    "code": "MEDICATION_DOXYCYCLINE_MALARIA",
    "category": "MEDICATION"
  },
  {
    "name": "Minocycline acne",
    "code": "MEDICATION_MINOCYCLINE_ACNE",
    "category": "MEDICATION"
  },
  {
    "name": "Oxytetracycline",
    "code": "MEDICATION_OXYTETRACYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Lymecycline",
    "code": "MEDICATION_LYMECYCLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Tigecycline repeat",
    "code": "MEDICATION_TIGECYCLINE_REPEAT",
    "category": "MEDICATION"
  },
  {
    "name": "Azithromycin chlamydia",
    "code": "MEDICATION_AZITHROMYCIN_CHLAMYDIA",
    "category": "MEDICATION"
  },
  {
    "name": "Azithromycin COPD",
    "code": "MEDICATION_AZITHROMYCIN_COPD",
    "category": "MEDICATION"
  },
  {
    "name": "Clarithromycin H pylori",
    "code": "MEDICATION_CLARITHROMYCIN_H_PYLORI",
    "category": "MEDICATION"
  },
  {
    "name": "Erythromycin gastroparesis",
    "code": "MEDICATION_ERYTHROMYCIN_GASTROPARESIS",
    "category": "MEDICATION"
  },
  {
    "name": "Metronidazole dental",
    "code": "MEDICATION_METRONIDAZOLE_DENTAL",
    "category": "MEDICATION"
  },
  {
    "name": "Tinidazole",
    "code": "MEDICATION_TINIDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Ornidazole",
    "code": "MEDICATION_ORNIDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Secnidazole",
    "code": "MEDICATION_SECNIDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Nitazoxanide",
    "code": "MEDICATION_NITAZOXANIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Albendazole",
    "code": "MEDICATION_ALBENDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Mebendazole",
    "code": "MEDICATION_MEBENDAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Praziquantel",
    "code": "MEDICATION_PRAZIQUANTEL",
    "category": "MEDICATION"
  },
  {
    "name": "Ivermectin",
    "code": "MEDICATION_IVERMECTIN",
    "category": "MEDICATION"
  },
  {
    "name": "Permethrin topical",
    "code": "MEDICATION_PERMETHRIN_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Malathion topical",
    "code": "MEDICATION_MALATHION_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Lindane historical",
    "code": "MEDICATION_LINDANE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Chloroquine malaria",
    "code": "MEDICATION_CHLOROQUINE_MALARIA",
    "category": "MEDICATION"
  },
  {
    "name": "Mefloquine",
    "code": "MEDICATION_MEFLOQUINE",
    "category": "MEDICATION"
  },
  {
    "name": "Atovaquone-proguanil",
    "code": "MEDICATION_ATOVAQUONE_PROGUANIL",
    "category": "MEDICATION"
  },
  {
    "name": "Doxycycline prophylaxis",
    "code": "MEDICATION_DOXYCYCLINE_PROPHYLAXIS",
    "category": "MEDICATION"
  },
  {
    "name": "Primaquine",
    "code": "MEDICATION_PRIMAQUINE",
    "category": "MEDICATION"
  },
  {
    "name": "Artemether-lumefantrine",
    "code": "MEDICATION_ARTEMETHER_LUMEFANTRINE",
    "category": "MEDICATION"
  },
  {
    "name": "Artesunate",
    "code": "MEDICATION_ARTESUNATE",
    "category": "MEDICATION"
  },
  {
    "name": "Quinine IV",
    "code": "MEDICATION_QUININE_IV",
    "category": "MEDICATION"
  },
  {
    "name": "Halofantrine historical",
    "code": "MEDICATION_HALOFANTRINE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Proguanil",
    "code": "MEDICATION_PROGUANIL",
    "category": "MEDICATION"
  },
  {
    "name": "Pyrimethamine",
    "code": "MEDICATION_PYRIMETHAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Sulfadoxine-pyrimethamine",
    "code": "MEDICATION_SULFADOXINE_PYRIMETHAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Dapsone",
    "code": "MEDICATION_DAPSONE",
    "category": "MEDICATION"
  },
  {
    "name": "Clofazimine",
    "code": "MEDICATION_CLOFAZIMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Ethionamide",
    "code": "MEDICATION_ETHIONAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Cycloserine",
    "code": "MEDICATION_CYCLOSERINE",
    "category": "MEDICATION"
  },
  {
    "name": "Linezolid TB",
    "code": "MEDICATION_LINEZOLID_TB",
    "category": "MEDICATION"
  },
  {
    "name": "Bedaquiline repeat",
    "code": "MEDICATION_BEDAQUILINE_REPEAT",
    "category": "MEDICATION"
  },
  {
    "name": "Delamanid repeat",
    "code": "MEDICATION_DELAMANID_REPEAT",
    "category": "MEDICATION"
  },
  {
    "name": "Pretomanid",
    "code": "MEDICATION_PRETOMANID",
    "category": "MEDICATION"
  },
  {
    "name": "Rifapentine",
    "code": "MEDICATION_RIFAPENTINE",
    "category": "MEDICATION"
  },
  {
    "name": "Rifabutin",
    "code": "MEDICATION_RIFABUTIN",
    "category": "MEDICATION"
  },
  {
    "name": "Acyclovir IV",
    "code": "MEDICATION_ACYCLOVIR_IV",
    "category": "MEDICATION"
  },
  {
    "name": "Ganciclovir",
    "code": "MEDICATION_GANCICLOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Valganciclovir",
    "code": "MEDICATION_VALGANCICLOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Foscarnet",
    "code": "MEDICATION_FOSCARNET",
    "category": "MEDICATION"
  },
  {
    "name": "Cidofovir",
    "code": "MEDICATION_CIDOFOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Letermovir",
    "code": "MEDICATION_LETERMOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Oseltamivir repeat",
    "code": "MEDICATION_OSELTAMIVIR_REPEAT",
    "category": "MEDICATION"
  },
  {
    "name": "Zanamivir",
    "code": "MEDICATION_ZANAMIVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Peramivir",
    "code": "MEDICATION_PERAMIVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Baloxavir",
    "code": "MEDICATION_BALOXAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Ribavirin",
    "code": "MEDICATION_RIBAVIRIN",
    "category": "MEDICATION"
  },
  {
    "name": "Sofosbuvir",
    "code": "MEDICATION_SOFOSBUVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Ledipasvir",
    "code": "MEDICATION_LEDIPASVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Daclatasvir",
    "code": "MEDICATION_DACLATASVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Velpatasvir",
    "code": "MEDICATION_VELPATASVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Glecaprevir-pibrentasvir",
    "code": "MEDICATION_GLECAPREVIR_PIBRENTASVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Entecavir",
    "code": "MEDICATION_ENTECAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Tenofovir",
    "code": "MEDICATION_TENOFOVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Lamivudine",
    "code": "MEDICATION_LAMIVUDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Emtricitabine",
    "code": "MEDICATION_EMTRICITABINE",
    "category": "MEDICATION"
  },
  {
    "name": "Abacavir",
    "code": "MEDICATION_ABACAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Zidovudine",
    "code": "MEDICATION_ZIDOVUDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Efavirenz",
    "code": "MEDICATION_EFAVIRENZ",
    "category": "MEDICATION"
  },
  {
    "name": "Nevirapine",
    "code": "MEDICATION_NEVIRAPINE",
    "category": "MEDICATION"
  },
  {
    "name": "Rilpivirine",
    "code": "MEDICATION_RILPIVIRINE",
    "category": "MEDICATION"
  },
  {
    "name": "Dolutegravir",
    "code": "MEDICATION_DOLUTEGRAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Raltegravir",
    "code": "MEDICATION_RALTEGRAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Bictegravir",
    "code": "MEDICATION_BICTEGRAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Darunavir",
    "code": "MEDICATION_DARUNAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Atazanavir",
    "code": "MEDICATION_ATAZANAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Lopinavir-ritonavir",
    "code": "MEDICATION_LOPINAVIR_RITONAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Ritonavir booster",
    "code": "MEDICATION_RITONAVIR_BOOSTER",
    "category": "MEDICATION"
  },
  {
    "name": "Maraviroc",
    "code": "MEDICATION_MARAVIROC",
    "category": "MEDICATION"
  },
  {
    "name": "Enfuvirtide",
    "code": "MEDICATION_ENFUVIRTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Ibalizumab",
    "code": "MEDICATION_IBALIZUMAB",
    "category": "MEDICATION"
  },
  {
    "name": "Fostemsavir",
    "code": "MEDICATION_FOSTEMSAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Lenacapavir",
    "code": "MEDICATION_LENACAPAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Remdesivir",
    "code": "MEDICATION_REMDESIVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Molnupiravir",
    "code": "MEDICATION_MOLNUPIRAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Nirmatrelvir-ritonavir",
    "code": "MEDICATION_NIRMATRELVIR_RITONAVIR",
    "category": "MEDICATION"
  },
  {
    "name": "Tixagevimab historical",
    "code": "MEDICATION_TIXAGEVIMAB_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Amphotericin B",
    "code": "MEDICATION_AMPHOTERICIN_B",
    "category": "MEDICATION"
  },
  {
    "name": "Flucytosine",
    "code": "MEDICATION_FLUCYTOSINE",
    "category": "MEDICATION"
  },
  {
    "name": "Voriconazole",
    "code": "MEDICATION_VORICONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Itraconazole",
    "code": "MEDICATION_ITRACONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Posaconazole",
    "code": "MEDICATION_POSACONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Isavuconazole",
    "code": "MEDICATION_ISAVUCONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Caspofungin",
    "code": "MEDICATION_CASPOFUNGIN",
    "category": "MEDICATION"
  },
  {
    "name": "Micafungin",
    "code": "MEDICATION_MICAFUNGIN",
    "category": "MEDICATION"
  },
  {
    "name": "Anidulafungin",
    "code": "MEDICATION_ANIDULAFUNGIN",
    "category": "MEDICATION"
  },
  {
    "name": "Terbinafine",
    "code": "MEDICATION_TERBINAFINE",
    "category": "MEDICATION"
  },
  {
    "name": "Griseofulvin",
    "code": "MEDICATION_GRISEOFULVIN",
    "category": "MEDICATION"
  },
  {
    "name": "Ketoconazole shampoo",
    "code": "MEDICATION_KETOCONAZOLE_SHAMPOO",
    "category": "MEDICATION"
  },
  {
    "name": "Clotrimazole",
    "code": "MEDICATION_CLOTRIMAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Miconazole",
    "code": "MEDICATION_MICONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Econazole",
    "code": "MEDICATION_ECONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Tioconazole",
    "code": "MEDICATION_TIOCONAZOLE",
    "category": "MEDICATION"
  },
  {
    "name": "Amorolfine nail",
    "code": "MEDICATION_AMOROLFINE_NAIL",
    "category": "MEDICATION"
  },
  {
    "name": "Ciclopirox nail",
    "code": "MEDICATION_CICLOPIROX_NAIL",
    "category": "MEDICATION"
  },
  {
    "name": "Undecylenic acid",
    "code": "MEDICATION_UNDECYLENIC_ACID",
    "category": "MEDICATION"
  },
  {
    "name": "Benzoic acid topical",
    "code": "MEDICATION_BENZOIC_ACID_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Salicylic acid wart",
    "code": "MEDICATION_SALICYLIC_ACID_WART",
    "category": "MEDICATION"
  },
  {
    "name": "Podophyllotoxin",
    "code": "MEDICATION_PODOPHYLLOTOXIN",
    "category": "MEDICATION"
  },
  {
    "name": "Imiquimod",
    "code": "MEDICATION_IMIQUIMOD",
    "category": "MEDICATION"
  },
  {
    "name": "Ingenol mebutate",
    "code": "MEDICATION_INGENOL_MEBUTATE",
    "category": "MEDICATION"
  },
  {
    "name": "Fluorouracil topical",
    "code": "MEDICATION_FLUOROURACIL_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Diclofenac gel",
    "code": "MEDICATION_DICLOFENAC_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Ibuprofen gel",
    "code": "MEDICATION_IBUPROFEN_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Piroxicam gel",
    "code": "MEDICATION_PIROXICAM_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Ketoprofen gel",
    "code": "MEDICATION_KETOPROFEN_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Felbinac gel",
    "code": "MEDICATION_FELBINAC_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Capsaicin cream",
    "code": "MEDICATION_CAPSAICIN_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Lidocaine patch",
    "code": "MEDICATION_LIDOCAINE_PATCH",
    "category": "MEDICATION"
  },
  {
    "name": "Lidocaine-prilocaine cream",
    "code": "MEDICATION_LIDOCAINE_PRILOCAINE_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Tetracaine topical",
    "code": "MEDICATION_TETRACAINE_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Benzocaine topical",
    "code": "MEDICATION_BENZOCAINE_TOPICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Phenazone ear drops",
    "code": "MEDICATION_PHENAZONE_EAR_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Hydrocortisone ear drops",
    "code": "MEDICATION_HYDROCORTISONE_EAR_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Betamethasone ear drops",
    "code": "MEDICATION_BETAMETHASONE_EAR_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Dexamethasone eye drops",
    "code": "MEDICATION_DEXAMETHASONE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Prednisolone eye drops",
    "code": "MEDICATION_PREDNISOLONE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Loteprednol eye drops",
    "code": "MEDICATION_LOTEPREDNOL_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Timolol eye drops",
    "code": "MEDICATION_TIMOLOL_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Latanoprost eye drops",
    "code": "MEDICATION_LATANOPROST_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Travoprost eye drops",
    "code": "MEDICATION_TRAVOPROST_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Bimatoprost eye drops",
    "code": "MEDICATION_BIMATOPROST_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Brimonidine eye drops",
    "code": "MEDICATION_BRIMONIDINE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Brinzolamide eye drops",
    "code": "MEDICATION_BRINZOLAMIDE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Dorzolamide eye drops",
    "code": "MEDICATION_DORZOLAMIDE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Pilocarpine eye drops",
    "code": "MEDICATION_PILOCARPINE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Atropine eye drops",
    "code": "MEDICATION_ATROPINE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Cyclopentolate eye drops",
    "code": "MEDICATION_CYCLOPENTOLATE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Tropicamide eye drops",
    "code": "MEDICATION_TROPICAMIDE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Olopatadine eye drops",
    "code": "MEDICATION_OLOPATADINE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Ketotifen eye drops",
    "code": "MEDICATION_KETOTIFEN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Sodium cromoglicate eye drops",
    "code": "MEDICATION_SODIUM_CROMOGLICATE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Heparin eye drops",
    "code": "MEDICATION_HEPARIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Hyaluronic acid eye drops",
    "code": "MEDICATION_HYALURONIC_ACID_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Carboxymethylcellulose eye drops",
    "code": "MEDICATION_CARBOXYMETHYLCELLULOSE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Polyethylene glycol eye drops",
    "code": "MEDICATION_POLYETHYLENE_GLYCOL_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Propamidine eye drops",
    "code": "MEDICATION_PROPAMIDINE_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Chloramphenicol eye ointment",
    "code": "MEDICATION_CHLORAMPHENICOL_EYE_OINTMENT",
    "category": "MEDICATION"
  },
  {
    "name": "Fusidic acid eye drops",
    "code": "MEDICATION_FUSIDIC_ACID_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Ofloxacin eye drops",
    "code": "MEDICATION_OFLOXACIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Ciprofloxacin eye drops",
    "code": "MEDICATION_CIPROFLOXACIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Moxifloxacin eye drops",
    "code": "MEDICATION_MOXIFLOXACIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Tobramycin eye drops",
    "code": "MEDICATION_TOBRAMYCIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Gentamicin eye drops",
    "code": "MEDICATION_GENTAMICIN_EYE_DROPS",
    "category": "MEDICATION"
  },
  {
    "name": "Aciclovir eye ointment",
    "code": "MEDICATION_ACICLOVIR_EYE_OINTMENT",
    "category": "MEDICATION"
  },
  {
    "name": "Ganciclovir implant historical",
    "code": "MEDICATION_GANCICLOVIR_IMPLANT_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Bevacizumab eye injection",
    "code": "MEDICATION_BEVACIZUMAB_EYE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Ranibizumab eye injection",
    "code": "MEDICATION_RANIBIZUMAB_EYE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Aflibercept eye injection",
    "code": "MEDICATION_AFLIBERCEPT_EYE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Brolucizumab eye injection",
    "code": "MEDICATION_BROLUCIZUMAB_EYE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Faricimab eye injection",
    "code": "MEDICATION_FARICIMAB_EYE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Pegaptanib historical",
    "code": "MEDICATION_PEGAPTANIB_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Verteporfin photodynamic",
    "code": "MEDICATION_VERTEPORFIN_PHOTODYNAMIC",
    "category": "MEDICATION"
  },
  {
    "name": "Acetazolamide",
    "code": "MEDICATION_ACETAZOLAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Methazolamide",
    "code": "MEDICATION_METHAZOLAMIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Dorzolamide oral historical",
    "code": "MEDICATION_DORZOLAMIDE_ORAL_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Mannitol IV",
    "code": "MEDICATION_MANNITOL_IV",
    "category": "MEDICATION"
  },
  {
    "name": "Glycerol oral",
    "code": "MEDICATION_GLYCEROL_ORAL",
    "category": "MEDICATION"
  },
  {
    "name": "Isosorbide mononitrate",
    "code": "MEDICATION_ISOSORBIDE_MONONITRATE",
    "category": "MEDICATION"
  },
  {
    "name": "Isosorbide dinitrate",
    "code": "MEDICATION_ISOSORBIDE_DINITRATE",
    "category": "MEDICATION"
  },
  {
    "name": "Glyceryl trinitrate spray",
    "code": "MEDICATION_GLYCERYL_TRINITRATE_SPRAY",
    "category": "MEDICATION"
  },
  {
    "name": "Glyceryl trinitrate patch",
    "code": "MEDICATION_GLYCERYL_TRINITRATE_PATCH",
    "category": "MEDICATION"
  },
  {
    "name": "Nicorandil",
    "code": "MEDICATION_NICORANDIL",
    "category": "MEDICATION"
  },
  {
    "name": "Ivabradine",
    "code": "MEDICATION_IVABRADINE",
    "category": "MEDICATION"
  },
  {
    "name": "Ranolazine",
    "code": "MEDICATION_RANOLAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Trimetazidine",
    "code": "MEDICATION_TRIMETAZIDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Perhexiline historical",
    "code": "MEDICATION_PERHEXILINE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Sacubitril-valsartan",
    "code": "MEDICATION_SACUBITRIL_VALSARTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Hydralazine",
    "code": "MEDICATION_HYDRALAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Minoxidil oral",
    "code": "MEDICATION_MINOXIDIL_ORAL",
    "category": "MEDICATION"
  },
  {
    "name": "Doxazosin",
    "code": "MEDICATION_DOXAZOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Prazosin",
    "code": "MEDICATION_PRAZOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Terazosin",
    "code": "MEDICATION_TERAZOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Indoramin",
    "code": "MEDICATION_INDORAMIN",
    "category": "MEDICATION"
  },
  {
    "name": "Moxonidine",
    "code": "MEDICATION_MOXONIDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Clonidine",
    "code": "MEDICATION_CLONIDINE",
    "category": "MEDICATION"
  },
  {
    "name": "Methyldopa",
    "code": "MEDICATION_METHYLDOPA",
    "category": "MEDICATION"
  },
  {
    "name": "Doxazosin BPH",
    "code": "MEDICATION_DOXAZOSIN_BPH",
    "category": "MEDICATION"
  },
  {
    "name": "Tamsulosin",
    "code": "MEDICATION_TAMSULOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Alfuzosin",
    "code": "MEDICATION_ALFUZOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Silodosin",
    "code": "MEDICATION_SILODOSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Finasteride",
    "code": "MEDICATION_FINASTERIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Dutasteride",
    "code": "MEDICATION_DUTASTERIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Sildenafil",
    "code": "MEDICATION_SILDENAFIL",
    "category": "MEDICATION"
  },
  {
    "name": "Tadalafil",
    "code": "MEDICATION_TADALAFIL",
    "category": "MEDICATION"
  },
  {
    "name": "Vardenafil",
    "code": "MEDICATION_VARDENAFIL",
    "category": "MEDICATION"
  },
  {
    "name": "Avanafil",
    "code": "MEDICATION_AVANAFIL",
    "category": "MEDICATION"
  },
  {
    "name": "Alprostadil",
    "code": "MEDICATION_ALPROSTADIL",
    "category": "MEDICATION"
  },
  {
    "name": "Papaverine injection",
    "code": "MEDICATION_PAPAVERINE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Phentolamine injection",
    "code": "MEDICATION_PHENTOLAMINE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Testosterone gel",
    "code": "MEDICATION_TESTOSTERONE_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Testosterone patch",
    "code": "MEDICATION_TESTOSTERONE_PATCH",
    "category": "MEDICATION"
  },
  {
    "name": "Testosterone injection",
    "code": "MEDICATION_TESTOSTERONE_INJECTION",
    "category": "MEDICATION"
  },
  {
    "name": "Nandrolone historical",
    "code": "MEDICATION_NANDROLONE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Oestrogen HRT",
    "code": "MEDICATION_OESTROGEN_HRT",
    "category": "MEDICATION"
  },
  {
    "name": "Oestrogen patch",
    "code": "MEDICATION_OESTROGEN_PATCH",
    "category": "MEDICATION"
  },
  {
    "name": "Progesterone HRT",
    "code": "MEDICATION_PROGESTERONE_HRT",
    "category": "MEDICATION"
  },
  {
    "name": "Medroxyprogesterone",
    "code": "MEDICATION_MEDROXYPROGESTERONE",
    "category": "MEDICATION"
  },
  {
    "name": "Norethisterone",
    "code": "MEDICATION_NORETHISTERONE",
    "category": "MEDICATION"
  },
  {
    "name": "Levonorgestrel IUS",
    "code": "MEDICATION_LEVONORGESTREL_IUS",
    "category": "MEDICATION"
  },
  {
    "name": "Etonogestrel implant",
    "code": "MEDICATION_ETONOGESTREL_IMPLANT",
    "category": "MEDICATION"
  },
  {
    "name": "Desogestrel pill",
    "code": "MEDICATION_DESOGESTREL_PILL",
    "category": "MEDICATION"
  },
  {
    "name": "Drospirenone pill",
    "code": "MEDICATION_DROSPIRENONE_PILL",
    "category": "MEDICATION"
  },
  {
    "name": "Cyproterone acetate",
    "code": "MEDICATION_CYPROTERONE_ACETATE",
    "category": "MEDICATION"
  },
  {
    "name": "Spironolactone acne",
    "code": "MEDICATION_SPIRONOLACTONE_ACNE",
    "category": "MEDICATION"
  },
  {
    "name": "Clomifene",
    "code": "MEDICATION_CLOMIFENE",
    "category": "MEDICATION"
  },
  {
    "name": "Letrozole fertility",
    "code": "MEDICATION_LETROZOLE_FERTILITY",
    "category": "MEDICATION"
  },
  {
    "name": "Gonadorelin",
    "code": "MEDICATION_GONADORELIN",
    "category": "MEDICATION"
  },
  {
    "name": "Chorionic gonadotrophin",
    "code": "MEDICATION_CHORIONIC_GONADOTROPHIN",
    "category": "MEDICATION"
  },
  {
    "name": "Menotropins",
    "code": "MEDICATION_MENOTROPINS",
    "category": "MEDICATION"
  },
  {
    "name": "Follitropin",
    "code": "MEDICATION_FOLLITROPIN",
    "category": "MEDICATION"
  },
  {
    "name": "Somatropin",
    "code": "MEDICATION_SOMATROPIN",
    "category": "MEDICATION"
  },
  {
    "name": "Octreotide",
    "code": "MEDICATION_OCTREOTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Lanreotide",
    "code": "MEDICATION_LANREOTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Pasireotide",
    "code": "MEDICATION_PASIREOTIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Pegvisomant",
    "code": "MEDICATION_PEGVISOMANT",
    "category": "MEDICATION"
  },
  {
    "name": "Cabergoline",
    "code": "MEDICATION_CABERGOLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Bromocriptine",
    "code": "MEDICATION_BROMOCRIPTINE",
    "category": "MEDICATION"
  },
  {
    "name": "Quinagolide",
    "code": "MEDICATION_QUINAGOLIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Desmopressin",
    "code": "MEDICATION_DESMOPRESSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Terlipressin",
    "code": "MEDICATION_TERLIPRESSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Vasopressin",
    "code": "MEDICATION_VASOPRESSIN",
    "category": "MEDICATION"
  },
  {
    "name": "Oxytocin",
    "code": "MEDICATION_OXYTOCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Carbetocin",
    "code": "MEDICATION_CARBETOCIN",
    "category": "MEDICATION"
  },
  {
    "name": "Misoprostol",
    "code": "MEDICATION_MISOPROSTOL",
    "category": "MEDICATION"
  },
  {
    "name": "Mifepristone",
    "code": "MEDICATION_MIFEPRISTONE",
    "category": "MEDICATION"
  },
  {
    "name": "Ergometrine",
    "code": "MEDICATION_ERGOMETRINE",
    "category": "MEDICATION"
  },
  {
    "name": "Syntocinon",
    "code": "MEDICATION_SYNTOCINON",
    "category": "MEDICATION"
  },
  {
    "name": "Nifedipine tocolysis",
    "code": "MEDICATION_NIFEDIPINE_TOCOLYSIS",
    "category": "MEDICATION"
  },
  {
    "name": "Atosiban",
    "code": "MEDICATION_ATOSIBAN",
    "category": "MEDICATION"
  },
  {
    "name": "Magnesium sulphate eclampsia",
    "code": "MEDICATION_MAGNESIUM_SULPHATE_ECLAMPSIA",
    "category": "MEDICATION"
  },
  {
    "name": "Betamethasone fetal lung",
    "code": "MEDICATION_BETAMETHASONE_FETAL_LUNG",
    "category": "MEDICATION"
  },
  {
    "name": "Dexamethasone fetal lung",
    "code": "MEDICATION_DEXAMETHASONE_FETAL_LUNG",
    "category": "MEDICATION"
  },
  {
    "name": "Ritodrine historical",
    "code": "MEDICATION_RITODRINE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Salbutamol tocolysis",
    "code": "MEDICATION_SALBUTAMOL_TOCOLYSIS",
    "category": "MEDICATION"
  },
  {
    "name": "Progesterone pessary",
    "code": "MEDICATION_PROGESTERONE_PESSARY",
    "category": "MEDICATION"
  },
  {
    "name": "Clotrimazole pessary",
    "code": "MEDICATION_CLOTRIMAZOLE_PESSARY",
    "category": "MEDICATION"
  },
  {
    "name": "Miconazole pessary",
    "code": "MEDICATION_MICONAZOLE_PESSARY",
    "category": "MEDICATION"
  },
  {
    "name": "Metronidazole pessary",
    "code": "MEDICATION_METRONIDAZOLE_PESSARY",
    "category": "MEDICATION"
  },
  {
    "name": "Tinidazole pessary",
    "code": "MEDICATION_TINIDAZOLE_PESSARY",
    "category": "MEDICATION"
  },
  {
    "name": "Aciclovir cream genital",
    "code": "MEDICATION_ACICLOVIR_CREAM_GENITAL",
    "category": "MEDICATION"
  },
  {
    "name": "Podophyllin historical",
    "code": "MEDICATION_PODOPHYLLIN_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Imiquimod genital warts",
    "code": "MEDICATION_IMIQUIMOD_GENITAL_WARTS",
    "category": "MEDICATION"
  },
  {
    "name": "Sinecatechins ointment",
    "code": "MEDICATION_SINECATECHINS_OINTMENT",
    "category": "MEDICATION"
  },
  {
    "name": "Benzoyl peroxide",
    "code": "MEDICATION_BENZOYL_PEROXIDE",
    "category": "MEDICATION"
  },
  {
    "name": "Adapalene",
    "code": "MEDICATION_ADAPALENE",
    "category": "MEDICATION"
  },
  {
    "name": "Tretinoin",
    "code": "MEDICATION_TRETINOIN",
    "category": "MEDICATION"
  },
  {
    "name": "Isotretinoin",
    "code": "MEDICATION_ISOTRETINOIN",
    "category": "MEDICATION"
  },
  {
    "name": "Azelaic acid",
    "code": "MEDICATION_AZELAIC_ACID",
    "category": "MEDICATION"
  },
  {
    "name": "Clindamycin acne gel",
    "code": "MEDICATION_CLINDAMYCIN_ACNE_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Erythromycin acne gel",
    "code": "MEDICATION_ERYTHROMYCIN_ACNE_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Dapsone acne gel",
    "code": "MEDICATION_DAPSONE_ACNE_GEL",
    "category": "MEDICATION"
  },
  {
    "name": "Spironolactone hirsutism",
    "code": "MEDICATION_SPIRONOLACTONE_HIRSUTISM",
    "category": "MEDICATION"
  },
  {
    "name": "Vaniqa cream",
    "code": "MEDICATION_VANIQA_CREAM",
    "category": "MEDICATION"
  },
  {
    "name": "Minoxidil topical hair",
    "code": "MEDICATION_MINOXIDIL_TOPICAL_HAIR",
    "category": "MEDICATION"
  },
  {
    "name": "Finasteride hair",
    "code": "MEDICATION_FINASTERIDE_HAIR",
    "category": "MEDICATION"
  },
  {
    "name": "Dutasteride hair",
    "code": "MEDICATION_DUTASTERIDE_HAIR",
    "category": "MEDICATION"
  },
  {
    "name": "Cetirizine chronic urticaria",
    "code": "MEDICATION_CETIRIZINE_CHRONIC_URTICARIA",
    "category": "MEDICATION"
  },
  {
    "name": "Loratadine chronic urticaria",
    "code": "MEDICATION_LORATADINE_CHRONIC_URTICARIA",
    "category": "MEDICATION"
  },
  {
    "name": "Fexofenadine chronic urticaria",
    "code": "MEDICATION_FEXOFENADINE_CHRONIC_URTICARIA",
    "category": "MEDICATION"
  },
  {
    "name": "Bilastine",
    "code": "MEDICATION_BILASTINE",
    "category": "MEDICATION"
  },
  {
    "name": "Desloratadine",
    "code": "MEDICATION_DESLORATADINE",
    "category": "MEDICATION"
  },
  {
    "name": "Levocetirizine",
    "code": "MEDICATION_LEVOCETIRIZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Promethazine",
    "code": "MEDICATION_PROMETHAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Hydroxyzine",
    "code": "MEDICATION_HYDROXYZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Cyclizine vertigo",
    "code": "MEDICATION_CYCLIZINE_VERTIGO",
    "category": "MEDICATION"
  },
  {
    "name": "Prochlorperazine",
    "code": "MEDICATION_PROCHLORPERAZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Metoclopramide vertigo",
    "code": "MEDICATION_METOCLOPRAMIDE_VERTIGO",
    "category": "MEDICATION"
  },
  {
    "name": "Betahistine",
    "code": "MEDICATION_BETAHISTINE",
    "category": "MEDICATION"
  },
  {
    "name": "Cinnarizine",
    "code": "MEDICATION_CINNARIZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Flunarizine",
    "code": "MEDICATION_FLUNARIZINE",
    "category": "MEDICATION"
  },
  {
    "name": "Pizotifen migraine prophylaxis",
    "code": "MEDICATION_PIZOTIFEN_MIGRAINE_PROPHYLAXIS",
    "category": "MEDICATION"
  },
  {
    "name": "Propranolol migraine",
    "code": "MEDICATION_PROPRANOLOL_MIGRAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Topiramate migraine",
    "code": "MEDICATION_TOPIRAMATE_MIGRAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Amitriptyline migraine",
    "code": "MEDICATION_AMITRIPTYLINE_MIGRAINE",
    "category": "MEDICATION"
  },
  {
    "name": "Sumatriptan",
    "code": "MEDICATION_SUMATRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Rizatriptan",
    "code": "MEDICATION_RIZATRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Zolmitriptan",
    "code": "MEDICATION_ZOLMITRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Eletriptan",
    "code": "MEDICATION_ELETRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Almotriptan",
    "code": "MEDICATION_ALMOTRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Frovatriptan",
    "code": "MEDICATION_FROVATRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Naratriptan",
    "code": "MEDICATION_NARATRIPTAN",
    "category": "MEDICATION"
  },
  {
    "name": "Ergotamine historical",
    "code": "MEDICATION_ERGOTAMINE_HISTORICAL",
    "category": "MEDICATION"
  },
  {
    "name": "Dihydroergotamine",
    "code": "MEDICATION_DIHYDROERGOTAMINE",
    "category": "MEDICATION"
  },
  {
    "name": "Greater occipital nerve block anaesthetic",
    "code": "MEDICATION_GREATER_OCCIPITAL_NERVE_BLOCK_ANAESTHETIC",
    "category": "MEDICATION"
  },
  {
    "name": "Botulinum toxin migraine",
    "code": "MEDICATION_BOTULINUM_TOXIN_MIGRAINE",
    "category": "MEDICATION"
  },
  {
    "name": "OnabotulinumtoxinA",
    "code": "MEDICATION_ONABOTULINUMTOXINA",
    "category": "MEDICATION"
  },
  {
    "name": "IncobotulinumtoxinA",
    "code": "MEDICATION_INCOBOTULINUMTOXINA",
    "category": "MEDICATION"
  },
  {
    "name": "AbobotulinumtoxinA",
    "code": "MEDICATION_ABOBOTULINUMTOXINA",
    "category": "MEDICATION"
  },
  {
    "name": "RimabotulinumtoxinB",
    "code": "MEDICATION_RIMABOTULINUMTOXINB",
    "category": "MEDICATION"
  },
  {
    "name": "Pralidoxime",
    "code": "MEDICATION_PRALIDOXIME",
    "category": "MEDICATION"
  },
  {
    "name": "Atropine organophosphate",
    "code": "MEDICATION_ATROPINE_ORGANOPHOSPHATE",
    "category": "MEDICATION"
  },
  {
    "name": "Naloxone",
    "code": "MEDICATION_NALOXONE",
    "category": "MEDICATION"
  },
  {
    "name": "Naltrexone",
    "code": "MEDICATION_NALTREXONE",
    "category": "MEDICATION"
  },
  {
    "name": "Buprenorphine-naloxone",
    "code": "MEDICATION_BUPRENORPHINE_NALOXONE",
    "category": "MEDICATION"
  },
  {
    "name": "Methadone maintenance",
    "code": "MEDICATION_METHADONE_MAINTENANCE",
    "category": "MEDICATION"
  },
  {
    "name": "Acamprosate",
    "code": "MEDICATION_ACAMPROSATE",
    "category": "MEDICATION"
  },
  {
    "name": "Disulfiram",
    "code": "MEDICATION_DISULFIRAM",
    "category": "MEDICATION"
  },
  {
    "name": "Nalmefene",
    "code": "MEDICATION_NALMEFENE",
    "category": "MEDICATION"
  },
  {
    "name": "Nicotine patch",
    "code": "MEDICATION_NICOTINE_PATCH",
    "category": "MEDICATION"
  },
  {
    "name": "Nicotine gum",
    "code": "MEDICATION_NICOTINE_GUM",
    "category": "MEDICATION"
  },
  {
    "name": "Nicotine inhalator",
    "code": "MEDICATION_NICOTINE_INHALATOR",
    "category": "MEDICATION"
  },
  {
    "name": "Nicotine lozenge",
    "code": "MEDICATION_NICOTINE_LOZENGE",
    "category": "MEDICATION"
  },
  {
    "name": "Nicotine spray",
    "code": "MEDICATION_NICOTINE_SPRAY",
    "category": "MEDICATION"
  },
  {
    "name": "Varenicline",
    "code": "MEDICATION_VARENICLINE",
    "category": "MEDICATION"
  },
  {
    "name": "Bupropion smoking cessation",
    "code": "MEDICATION_BUPROPION_SMOKING_CESSATION",
    "category": "MEDICATION"
  },
  {
    "name": "Cytisine",
    "code": "MEDICATION_CYTISINE",
    "category": "MEDICATION"
  },
  {
    "name": "Other / not listed",
    "code": "OTHER_OTHER_NOT_LISTED",
    "category": "OTHER"
  },
  {
    "name": "Exercise-induced allergy",
    "code": "OTHER_EXERCISE_INDUCED_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Cold urticaria (cold exposure)",
    "code": "OTHER_COLD_URTICARIA_COLD_EXPOSURE",
    "category": "OTHER"
  },
  {
    "name": "Heat urticaria",
    "code": "OTHER_HEAT_URTICARIA",
    "category": "OTHER"
  },
  {
    "name": "Solar urticaria (sunlight)",
    "code": "OTHER_SOLAR_URTICARIA_SUNLIGHT",
    "category": "OTHER"
  },
  {
    "name": "Aquagenic urticaria (water)",
    "code": "OTHER_AQUAGENIC_URTICARIA_WATER",
    "category": "OTHER"
  },
  {
    "name": "Cholinergic urticaria (sweat)",
    "code": "OTHER_CHOLINERGIC_URTICARIA_SWEAT",
    "category": "OTHER"
  },
  {
    "name": "Pressure urticaria",
    "code": "OTHER_PRESSURE_URTICARIA",
    "category": "OTHER"
  },
  {
    "name": "Vibratory urticaria",
    "code": "OTHER_VIBRATORY_URTICARIA",
    "category": "OTHER"
  },
  {
    "name": "Dermatographism",
    "code": "OTHER_DERMATOGRAPHISM",
    "category": "OTHER"
  },
  {
    "name": "Contact urticaria (unspecified)",
    "code": "OTHER_CONTACT_URTICARIA_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Idiopathic urticaria",
    "code": "OTHER_IDIOPATHIC_URTICARIA",
    "category": "OTHER"
  },
  {
    "name": "Angioedema (unspecified trigger)",
    "code": "OTHER_ANGIOEDEMA_UNSPECIFIED_TRIGGER",
    "category": "OTHER"
  },
  {
    "name": "Anaphylaxis (unspecified trigger)",
    "code": "OTHER_ANAPHYLAXIS_UNSPECIFIED_TRIGGER",
    "category": "OTHER"
  },
  {
    "name": "Food-dependent exercise-induced",
    "code": "OTHER_FOOD_DEPENDENT_EXERCISE_INDUCED",
    "category": "OTHER"
  },
  {
    "name": "Alcohol flush reaction",
    "code": "OTHER_ALCOHOL_FLUSH_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Histamine intolerance",
    "code": "OTHER_HISTAMINE_INTOLERANCE",
    "category": "OTHER"
  },
  {
    "name": "Tyramine sensitivity",
    "code": "OTHER_TYRAMINE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Salicylate sensitivity",
    "code": "OTHER_SALICYLATE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Glutamate sensitivity",
    "code": "OTHER_GLUTAMATE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Sulphite sensitivity (non-food)",
    "code": "OTHER_SULPHITE_SENSITIVITY_NON_FOOD",
    "category": "OTHER"
  },
  {
    "name": "Multiple chemical sensitivity",
    "code": "OTHER_MULTIPLE_CHEMICAL_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Seminal fluid allergy",
    "code": "OTHER_SEMINAL_FLUID_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Sweat allergy",
    "code": "OTHER_SWEAT_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Latex-fruit syndrome",
    "code": "OTHER_LATEX_FRUIT_SYNDROME",
    "category": "OTHER"
  },
  {
    "name": "Pollen-food syndrome",
    "code": "OTHER_POLLEN_FOOD_SYNDROME",
    "category": "OTHER"
  },
  {
    "name": "Oral allergy syndrome",
    "code": "OTHER_ORAL_ALLERGY_SYNDROME",
    "category": "OTHER"
  },
  {
    "name": "Eosinophilic oesophagitis (trigger unknown)",
    "code": "OTHER_EOSINOPHILIC_OESOPHAGITIS_TRIGGER_UNKNOWN",
    "category": "OTHER"
  },
  {
    "name": "Non-coeliac gluten sensitivity",
    "code": "OTHER_NON_COELIAC_GLUTEN_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Fructose malabsorption",
    "code": "OTHER_FRUCTOSE_MALABSORPTION",
    "category": "OTHER"
  },
  {
    "name": "Sorbitol intolerance",
    "code": "OTHER_SORBITOL_INTOLERANCE",
    "category": "OTHER"
  },
  {
    "name": "Caffeine sensitivity",
    "code": "OTHER_CAFFEINE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Alcohol intolerance (metabolic)",
    "code": "OTHER_ALCOHOL_INTOLERANCE_METABOLIC",
    "category": "OTHER"
  },
  {
    "name": "Red meat alpha-gal syndrome",
    "code": "OTHER_RED_MEAT_ALPHA_GAL_SYNDROME",
    "category": "OTHER"
  },
  {
    "name": "Tick bite induced meat allergy",
    "code": "OTHER_TICK_BITE_INDUCED_MEAT_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Contrast media premedication needed",
    "code": "OTHER_CONTRAST_MEDIA_PREMEDICATION_NEEDED",
    "category": "OTHER"
  },
  {
    "name": "NSAID-exacerbated respiratory disease",
    "code": "OTHER_NSAID_EXACERBATED_RESPIRATORY_DISEASE",
    "category": "OTHER"
  },
  {
    "name": "Aspirin-exacerbated respiratory disease",
    "code": "OTHER_ASPIRIN_EXACERBATED_RESPIRATORY_DISEASE",
    "category": "OTHER"
  },
  {
    "name": "Latex-associated asthma",
    "code": "OTHER_LATEX_ASSOCIATED_ASTHMA",
    "category": "OTHER"
  },
  {
    "name": "Occupational asthma (unspecified)",
    "code": "OTHER_OCCUPATIONAL_ASTHMA_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Hereditary angioedema",
    "code": "OTHER_HEREDITARY_ANGIOEDEMA",
    "category": "OTHER"
  },
  {
    "name": "Mast cell activation syndrome",
    "code": "OTHER_MAST_CELL_ACTIVATION_SYNDROME",
    "category": "OTHER"
  },
  {
    "name": "Idiopathic anaphylaxis",
    "code": "OTHER_IDIOPATHIC_ANAPHYLAXIS",
    "category": "OTHER"
  },
  {
    "name": "Unspecified drug allergy",
    "code": "OTHER_UNSPECIFIED_DRUG_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Unspecified food allergy",
    "code": "OTHER_UNSPECIFIED_FOOD_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Unspecified environmental allergy",
    "code": "OTHER_UNSPECIFIED_ENVIRONMENTAL_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Seasonal symptoms (unspecified)",
    "code": "OTHER_SEASONAL_SYMPTOMS_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Perennial symptoms (unspecified)",
    "code": "OTHER_PERENNIAL_SYMPTOMS_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Unknown allergen — under investigation",
    "code": "OTHER_UNKNOWN_ALLERGEN_UNDER_INVESTIGATION",
    "category": "OTHER"
  },
  {
    "name": "Allergy testing pending",
    "code": "OTHER_ALLERGY_TESTING_PENDING",
    "category": "OTHER"
  },
  {
    "name": "Previous anaphylaxis — trigger unclear",
    "code": "OTHER_PREVIOUS_ANAPHYLAXIS_TRIGGER_UNCLEAR",
    "category": "OTHER"
  },
  {
    "name": "Carer-reported allergy unverified",
    "code": "OTHER_CARER_REPORTED_ALLERGY_UNVERIFIED",
    "category": "OTHER"
  },
  {
    "name": "Cross-reactivity suspected",
    "code": "OTHER_CROSS_REACTIVITY_SUSPECTED",
    "category": "OTHER"
  },
  {
    "name": "Multiple allergies",
    "code": "OTHER_MULTIPLE_ALLERGIES",
    "category": "OTHER"
  },
  {
    "name": "Severe allergy (unspecified)",
    "code": "OTHER_SEVERE_ALLERGY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Mild allergy (unspecified)",
    "code": "OTHER_MILD_ALLERGY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to herbal remedy (unspecified)",
    "code": "OTHER_ALLERGY_TO_HERBAL_REMEDY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to supplement (unspecified)",
    "code": "OTHER_ALLERGY_TO_SUPPLEMENT_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to insect repellent",
    "code": "OTHER_ALLERGY_TO_INSECT_REPELLENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wet wipes",
    "code": "OTHER_ALLERGY_TO_WET_WIPES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nappy cream",
    "code": "OTHER_ALLERGY_TO_NAPPY_CREAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to barrier cream",
    "code": "OTHER_ALLERGY_TO_BARRIER_CREAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to stoma products",
    "code": "OTHER_ALLERGY_TO_STOMA_PRODUCTS",
    "category": "OTHER"
  },
  {
    "name": "Allergy to catheter material",
    "code": "OTHER_ALLERGY_TO_CATHETER_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wound dressing",
    "code": "OTHER_ALLERGY_TO_WOUND_DRESSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to ostomy adhesive",
    "code": "OTHER_ALLERGY_TO_OSTOMY_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to mouthwash",
    "code": "OTHER_ALLERGY_TO_MOUTHWASH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to toothpaste",
    "code": "OTHER_ALLERGY_TO_TOOTHPASTE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to transdermal patch adhesive",
    "code": "OTHER_ALLERGY_TO_TRANSDERMAL_PATCH_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nicotine patch",
    "code": "OTHER_ALLERGY_TO_NICOTINE_PATCH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hormone patch",
    "code": "OTHER_ALLERGY_TO_HORMONE_PATCH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pain relief patch",
    "code": "OTHER_ALLERGY_TO_PAIN_RELIEF_PATCH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to lubricating gel",
    "code": "OTHER_ALLERGY_TO_LUBRICATING_GEL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to condom latex",
    "code": "OTHER_ALLERGY_TO_CONDOM_LATEX",
    "category": "OTHER"
  },
  {
    "name": "Allergy to incontinence pad",
    "code": "OTHER_ALLERGY_TO_INCONTINENCE_PAD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wheelchair cushion",
    "code": "OTHER_ALLERGY_TO_WHEELCHAIR_CUSHION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hoist sling material",
    "code": "OTHER_ALLERGY_TO_HOIST_SLING_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to care home laundry product",
    "code": "OTHER_ALLERGY_TO_CARE_HOME_LAUNDRY_PRODUCT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to chlorhexidine wash",
    "code": "OTHER_ALLERGY_TO_CHLORHEXIDINE_WASH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to barrier wipes",
    "code": "OTHER_ALLERGY_TO_BARRIER_WIPES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to micropore tape",
    "code": "OTHER_ALLERGY_TO_MICROPORE_TAPE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to transparent film dressing",
    "code": "OTHER_ALLERGY_TO_TRANSPARENT_FILM_DRESSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hydrocolloid dressing",
    "code": "OTHER_ALLERGY_TO_HYDROCOLLOID_DRESSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to iodine swab",
    "code": "OTHER_ALLERGY_TO_IODINE_SWAB",
    "category": "OTHER"
  },
  {
    "name": "Allergy to alcohol swab",
    "code": "OTHER_ALLERGY_TO_ALCOHOL_SWAB",
    "category": "OTHER"
  },
  {
    "name": "Allergy to propylene glycol",
    "code": "OTHER_ALLERGY_TO_PROPYLENE_GLYCOL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to parabens",
    "code": "OTHER_ALLERGY_TO_PARABENS",
    "category": "OTHER"
  },
  {
    "name": "Allergy to formaldehyde releasers",
    "code": "OTHER_ALLERGY_TO_FORMALDEHYDE_RELEASERS",
    "category": "OTHER"
  },
  {
    "name": "Allergy to methylisothiazolinone",
    "code": "OTHER_ALLERGY_TO_METHYLISOTHIAZOLINONE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to benzalkonium chloride",
    "code": "OTHER_ALLERGY_TO_BENZALKONIUM_CHLORIDE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wool alcohols (lanolin)",
    "code": "OTHER_ALLERGY_TO_WOOL_ALCOHOLS_LANOLIN",
    "category": "OTHER"
  },
  {
    "name": "Allergy to peanut trace (airborne)",
    "code": "OTHER_ALLERGY_TO_PEANUT_TRACE_AIRBORNE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nut trace (airborne)",
    "code": "OTHER_ALLERGY_TO_NUT_TRACE_AIRBORNE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to fish cooking fumes",
    "code": "OTHER_ALLERGY_TO_FISH_COOKING_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to shellfish cooking fumes",
    "code": "OTHER_ALLERGY_TO_SHELLFISH_COOKING_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sesame airborne",
    "code": "OTHER_ALLERGY_TO_SESAME_AIRBORNE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to egg airborne baking",
    "code": "OTHER_ALLERGY_TO_EGG_AIRBORNE_BAKING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to milk airborne cooking",
    "code": "OTHER_ALLERGY_TO_MILK_AIRBORNE_COOKING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wheat flour airborne",
    "code": "OTHER_ALLERGY_TO_WHEAT_FLOUR_AIRBORNE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to massage oil",
    "code": "OTHER_ALLERGY_TO_MASSAGE_OIL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to aromatherapy blend",
    "code": "OTHER_ALLERGY_TO_AROMATHERAPY_BLEND",
    "category": "OTHER"
  },
  {
    "name": "Allergy to enteral feed formula",
    "code": "OTHER_ALLERGY_TO_ENTERAL_FEED_FORMULA",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sip feed supplement",
    "code": "OTHER_ALLERGY_TO_SIP_FEED_SUPPLEMENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to thickener powder",
    "code": "OTHER_ALLERGY_TO_THICKENER_POWDER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to IV catheter material",
    "code": "OTHER_ALLERGY_TO_IV_CATHETER_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to blood transfusion component",
    "code": "OTHER_ALLERGY_TO_BLOOD_TRANSFUSION_COMPONENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to surgical suture material",
    "code": "OTHER_ALLERGY_TO_SURGICAL_SUTURE_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to vaccine excipient (unspecified)",
    "code": "OTHER_ALLERGY_TO_VACCINE_EXCIPIENT_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to egg in flu vaccine",
    "code": "OTHER_ALLERGY_TO_EGG_IN_FLU_VACCINE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to gelatin in vaccine",
    "code": "OTHER_ALLERGY_TO_GELATIN_IN_VACCINE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to polysorbate in vaccine",
    "code": "OTHER_ALLERGY_TO_POLYSORBATE_IN_VACCINE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to polyethylene glycol (PEG)",
    "code": "OTHER_ALLERGY_TO_POLYETHYLENE_GLYCOL_PEG",
    "category": "OTHER"
  },
  {
    "name": "Allergy to polysorbate 80",
    "code": "OTHER_ALLERGY_TO_POLYSORBATE_80",
    "category": "OTHER"
  },
  {
    "name": "Allergy to lactose in tablet filler",
    "code": "OTHER_ALLERGY_TO_LACTOSE_IN_TABLET_FILLER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to tartrazine dye",
    "code": "OTHER_ALLERGY_TO_TARTRAZINE_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to cochineal / carmine dye",
    "code": "OTHER_ALLERGY_TO_COCHINEAL_CARMINE_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to unspecified food dye",
    "code": "OTHER_ALLERGY_TO_UNSPECIFIED_FOOD_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to dental amalgam",
    "code": "OTHER_ALLERGY_TO_DENTAL_AMALGAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to composite filling",
    "code": "OTHER_ALLERGY_TO_COMPOSITE_FILLING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to fluoride treatment",
    "code": "OTHER_ALLERGY_TO_FLUORIDE_TREATMENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to essential oil diffuser",
    "code": "OTHER_ALLERGY_TO_ESSENTIAL_OIL_DIFFUSER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to prosthetic liner",
    "code": "OTHER_ALLERGY_TO_PROSTHETIC_LINER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to CPAP mask material",
    "code": "OTHER_ALLERGY_TO_CPAP_MASK_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nebuliser mask",
    "code": "OTHER_ALLERGY_TO_NEBULISER_MASK",
    "category": "OTHER"
  },
  {
    "name": "Allergy to oxygen mask",
    "code": "OTHER_ALLERGY_TO_OXYGEN_MASK",
    "category": "OTHER"
  },
  {
    "name": "Allergy to enteral tube material",
    "code": "OTHER_ALLERGY_TO_ENTERAL_TUBE_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to PEG dressing",
    "code": "OTHER_ALLERGY_TO_PEG_DRESSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to immunoglobulin infusion",
    "code": "OTHER_ALLERGY_TO_IMMUNOGLOBULIN_INFUSION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to dialysis fluid",
    "code": "OTHER_ALLERGY_TO_DIALYSIS_FLUID",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bone cement",
    "code": "OTHER_ALLERGY_TO_BONE_CEMENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to joint replacement metal",
    "code": "OTHER_ALLERGY_TO_JOINT_REPLACEMENT_METAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pacemaker material",
    "code": "OTHER_ALLERGY_TO_PACEMAKER_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to implantable device coating",
    "code": "OTHER_ALLERGY_TO_IMPLANTABLE_DEVICE_COATING",
    "category": "OTHER"
  },
  {
    "name": "Childhood allergy (outgrown unknown)",
    "code": "OTHER_CHILDHOOD_ALLERGY_OUTGROWN_UNKNOWN",
    "category": "OTHER"
  },
  {
    "name": "Adult-onset allergy",
    "code": "OTHER_ADULT_ONSET_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Eye symptoms only (unspecified)",
    "code": "OTHER_EYE_SYMPTOMS_ONLY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Nasal symptoms only (unspecified)",
    "code": "OTHER_NASAL_SYMPTOMS_ONLY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Skin symptoms only (unspecified)",
    "code": "OTHER_SKIN_SYMPTOMS_ONLY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "GI symptoms only (unspecified)",
    "code": "OTHER_GI_SYMPTOMS_ONLY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Breathing symptoms only (unspecified)",
    "code": "OTHER_BREATHING_SYMPTOMS_ONLY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Hospital admission — allergy history",
    "code": "OTHER_HOSPITAL_ADMISSION_ALLERGY_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Family history only (not confirmed)",
    "code": "OTHER_FAMILY_HISTORY_ONLY_NOT_CONFIRMED",
    "category": "OTHER"
  },
  {
    "name": "Moderate allergy (unspecified)",
    "code": "OTHER_MODERATE_ALLERGY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to unknown medication batch",
    "code": "OTHER_ALLERGY_TO_UNKNOWN_MEDICATION_BATCH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to traditional medicine",
    "code": "OTHER_ALLERGY_TO_TRADITIONAL_MEDICINE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to homeopathic preparation",
    "code": "OTHER_ALLERGY_TO_HOMEOPATHIC_PREPARATION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sunless tanning product",
    "code": "OTHER_ALLERGY_TO_SUNLESS_TANNING_PRODUCT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hearing aid dome",
    "code": "OTHER_ALLERGY_TO_HEARING_AID_DOME",
    "category": "OTHER"
  },
  {
    "name": "Allergy to denture adhesive",
    "code": "OTHER_ALLERGY_TO_DENTURE_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to spectacle frame material",
    "code": "OTHER_ALLERGY_TO_SPECTACLE_FRAME_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to contact lenses",
    "code": "OTHER_ALLERGY_TO_CONTACT_LENSES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to eye lubricant",
    "code": "OTHER_ALLERGY_TO_EYE_LUBRICANT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nasal spray preservative",
    "code": "OTHER_ALLERGY_TO_NASAL_SPRAY_PRESERVATIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to throat lozenges",
    "code": "OTHER_ALLERGY_TO_THROAT_LOZENGES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to cough mixture",
    "code": "OTHER_ALLERGY_TO_COUGH_MIXTURE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to vapour rub",
    "code": "OTHER_ALLERGY_TO_VAPOUR_RUB",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sublingual tablet",
    "code": "OTHER_ALLERGY_TO_SUBLINGUAL_TABLET",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pessary material",
    "code": "OTHER_ALLERGY_TO_PESSARY_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to diaphragm material",
    "code": "OTHER_ALLERGY_TO_DIAPHRAGM_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to menstrual cup material",
    "code": "OTHER_ALLERGY_TO_MENSTRUAL_CUP_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to tampon fibres",
    "code": "OTHER_ALLERGY_TO_TAMPON_FIBRES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sanitary pad adhesive",
    "code": "OTHER_ALLERGY_TO_SANITARY_PAD_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bed rail foam",
    "code": "OTHER_ALLERGY_TO_BED_RAIL_FOAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to transfer board",
    "code": "OTHER_ALLERGY_TO_TRANSFER_BOARD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to slide sheet fabric",
    "code": "OTHER_ALLERGY_TO_SLIDE_SHEET_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Allergy to agency uniform fabric",
    "code": "OTHER_ALLERGY_TO_AGENCY_UNIFORM_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Allergy to name badge clip nickel",
    "code": "OTHER_ALLERGY_TO_NAME_BADGE_CLIP_NICKEL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hand cream (carer)",
    "code": "OTHER_ALLERGY_TO_HAND_CREAM_CARER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to glove powder",
    "code": "OTHER_ALLERGY_TO_GLOVE_POWDER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to barrier film spray",
    "code": "OTHER_ALLERGY_TO_BARRIER_FILM_SPRAY",
    "category": "OTHER"
  },
  {
    "name": "Allergy to stoma powder",
    "code": "OTHER_ALLERGY_TO_STOMA_POWDER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to adhesive remover",
    "code": "OTHER_ALLERGY_TO_ADHESIVE_REMOVER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to stockings (compression)",
    "code": "OTHER_ALLERGY_TO_STOCKINGS_COMPRESSION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to zinc oxide tape",
    "code": "OTHER_ALLERGY_TO_ZINC_OXIDE_TAPE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to alginate dressing",
    "code": "OTHER_ALLERGY_TO_ALGINATE_DRESSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to foam dressing adhesive",
    "code": "OTHER_ALLERGY_TO_FOAM_DRESSING_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to food additive E-number unknown",
    "code": "OTHER_ALLERGY_TO_FOOD_ADDITIVE_E_NUMBER_UNKNOWN",
    "category": "OTHER"
  },
  {
    "name": "Allergy to unspecified E-number",
    "code": "OTHER_ALLERGY_TO_UNSPECIFIED_E_NUMBER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to car air freshener",
    "code": "OTHER_ALLERGY_TO_CAR_AIR_FRESHENER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hotel bedding",
    "code": "OTHER_ALLERGY_TO_HOTEL_BEDDING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to holiday accommodation mould",
    "code": "OTHER_ALLERGY_TO_HOLIDAY_ACCOMMODATION_MOULD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to plane cabin air",
    "code": "OTHER_ALLERGY_TO_PLANE_CABIN_AIR",
    "category": "OTHER"
  },
  {
    "name": "Allergy to spa treatment product",
    "code": "OTHER_ALLERGY_TO_SPA_TREATMENT_PRODUCT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to gym equipment rubber",
    "code": "OTHER_ALLERGY_TO_GYM_EQUIPMENT_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to yoga mat material",
    "code": "OTHER_ALLERGY_TO_YOGA_MAT_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to resistance band latex",
    "code": "OTHER_ALLERGY_TO_RESISTANCE_BAND_LATEX",
    "category": "OTHER"
  },
  {
    "name": "Allergy to swimming cap silicone",
    "code": "OTHER_ALLERGY_TO_SWIMMING_CAP_SILICONE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to goggles strap",
    "code": "OTHER_ALLERGY_TO_GOGGLES_STRAP",
    "category": "OTHER"
  },
  {
    "name": "Allergy to dental floss wax",
    "code": "OTHER_ALLERGY_TO_DENTAL_FLOSS_WAX",
    "category": "OTHER"
  },
  {
    "name": "Allergy to water flosser solution",
    "code": "OTHER_ALLERGY_TO_WATER_FLOSSER_SOLUTION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to CPAP hose",
    "code": "OTHER_ALLERGY_TO_CPAP_HOSE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to modified texture food (unspecified)",
    "code": "OTHER_ALLERGY_TO_MODIFIED_TEXTURE_FOOD_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Allergy to IV fluid additive",
    "code": "OTHER_ALLERGY_TO_IV_FLUID_ADDITIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to plasma product",
    "code": "OTHER_ALLERGY_TO_PLASMA_PRODUCT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to peritoneal dialysis solution",
    "code": "OTHER_ALLERGY_TO_PERITONEAL_DIALYSIS_SOLUTION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to haemodialysis membrane",
    "code": "OTHER_ALLERGY_TO_HAEMODIALYSIS_MEMBRANE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to surgical staple metal",
    "code": "OTHER_ALLERGY_TO_SURGICAL_STAPLE_METAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to contrast flush saline additive",
    "code": "OTHER_ALLERGY_TO_CONTRAST_FLUSH_SALINE_ADDITIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to neomycin in vaccine",
    "code": "OTHER_ALLERGY_TO_NEOMYCIN_IN_VACCINE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to carboxymethylcellulose",
    "code": "OTHER_ALLERGY_TO_CARBOXYMETHYLCELLULOSE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to microcrystalline cellulose filler",
    "code": "OTHER_ALLERGY_TO_MICROCRYSTALLINE_CELLULOSE_FILLER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to starch in tablet filler",
    "code": "OTHER_ALLERGY_TO_STARCH_IN_TABLET_FILLER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to sunset yellow dye",
    "code": "OTHER_ALLERGY_TO_SUNSET_YELLOW_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to patent blue dye",
    "code": "OTHER_ALLERGY_TO_PATENT_BLUE_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to annatto dye",
    "code": "OTHER_ALLERGY_TO_ANNATTO_DYE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to nickel in diet (coin ingestion)",
    "code": "OTHER_ALLERGY_TO_NICKEL_IN_DIET_COIN_INGESTION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to cobalt in diet",
    "code": "OTHER_ALLERGY_TO_COBALT_IN_DIET",
    "category": "OTHER"
  },
  {
    "name": "Allergy to titanium (rare)",
    "code": "OTHER_ALLERGY_TO_TITANIUM_RARE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to glass ionomer cement",
    "code": "OTHER_ALLERGY_TO_GLASS_IONOMER_CEMENT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to root canal sealant",
    "code": "OTHER_ALLERGY_TO_ROOT_CANAL_SEALANT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to impression paste",
    "code": "OTHER_ALLERGY_TO_IMPRESSION_PASTE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to chlorhexidine mouth rinse",
    "code": "OTHER_ALLERGY_TO_CHLORHEXIDINE_MOUTH_RINSE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hydrogen peroxide rinse",
    "code": "OTHER_ALLERGY_TO_HYDROGEN_PEROXIDE_RINSE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to reed diffuser fluid",
    "code": "OTHER_ALLERGY_TO_REED_DIFFUSER_FLUID",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pot pourri",
    "code": "OTHER_ALLERGY_TO_POT_POURRI",
    "category": "OTHER"
  },
  {
    "name": "Allergy to scented drawer liners",
    "code": "OTHER_ALLERGY_TO_SCENTED_DRAWER_LINERS",
    "category": "OTHER"
  },
  {
    "name": "Allergy to moth repellent sachet",
    "code": "OTHER_ALLERGY_TO_MOTH_REPELLENT_SACHET",
    "category": "OTHER"
  },
  {
    "name": "Allergy to shoe polish",
    "code": "OTHER_ALLERGY_TO_SHOE_POLISH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to leather shoe lining",
    "code": "OTHER_ALLERGY_TO_LEATHER_SHOE_LINING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to insole adhesive",
    "code": "OTHER_ALLERGY_TO_INSOLE_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to orthotic device material",
    "code": "OTHER_ALLERGY_TO_ORTHOTIC_DEVICE_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to prosthetic socket material",
    "code": "OTHER_ALLERGY_TO_PROSTHETIC_SOCKET_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to walking stick handle",
    "code": "OTHER_ALLERGY_TO_WALKING_STICK_HANDLE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to rollator grip foam",
    "code": "OTHER_ALLERGY_TO_ROLLATOR_GRIP_FOAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to zimmer frame rubber feet",
    "code": "OTHER_ALLERGY_TO_ZIMMER_FRAME_RUBBER_FEET",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bath lift seat material",
    "code": "OTHER_ALLERGY_TO_BATH_LIFT_SEAT_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to shower chair padding",
    "code": "OTHER_ALLERGY_TO_SHOWER_CHAIR_PADDING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to commode seat material",
    "code": "OTHER_ALLERGY_TO_COMMODE_SEAT_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bed rail coating",
    "code": "OTHER_ALLERGY_TO_BED_RAIL_COATING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to mattress protector plastic",
    "code": "OTHER_ALLERGY_TO_MATTRESS_PROTECTOR_PLASTIC",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pressure cushion cover",
    "code": "OTHER_ALLERGY_TO_PRESSURE_CUSHION_COVER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hoisting sling padding",
    "code": "OTHER_ALLERGY_TO_HOISTING_SLING_PADDING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to standing aid belt",
    "code": "OTHER_ALLERGY_TO_STANDING_AID_BELT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to repositioning sheet",
    "code": "OTHER_ALLERGY_TO_REPOSITIONING_SHEET",
    "category": "OTHER"
  },
  {
    "name": "Allergy to turning wedge foam",
    "code": "OTHER_ALLERGY_TO_TURNING_WEDGE_FOAM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bed cradle fabric",
    "code": "OTHER_ALLERGY_TO_BED_CRADLE_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Allergy to chair raiser rubber",
    "code": "OTHER_ALLERGY_TO_CHAIR_RAISER_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to grab rail coating",
    "code": "OTHER_ALLERGY_TO_GRAB_RAIL_COATING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to toilet frame padding",
    "code": "OTHER_ALLERGY_TO_TOILET_FRAME_PADDING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bath mat rubber",
    "code": "OTHER_ALLERGY_TO_BATH_MAT_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to shower curtain PVC",
    "code": "OTHER_ALLERGY_TO_SHOWER_CURTAIN_PVC",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bathroom sealant mould",
    "code": "OTHER_ALLERGY_TO_BATHROOM_SEALANT_MOULD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to grout mould",
    "code": "OTHER_ALLERGY_TO_GROUT_MOULD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to extractor fan dust",
    "code": "OTHER_ALLERGY_TO_EXTRACTOR_FAN_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to kitchen grease aerosol",
    "code": "OTHER_ALLERGY_TO_KITCHEN_GREASE_AEROSOL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to oven cleaner residue",
    "code": "OTHER_ALLERGY_TO_OVEN_CLEANER_RESIDUE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to dishwasher tablet residue",
    "code": "OTHER_ALLERGY_TO_DISHWASHER_TABLET_RESIDUE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to washing up liquid",
    "code": "OTHER_ALLERGY_TO_WASHING_UP_LIQUID",
    "category": "OTHER"
  },
  {
    "name": "Allergy to surface spray kitchen",
    "code": "OTHER_ALLERGY_TO_SURFACE_SPRAY_KITCHEN",
    "category": "OTHER"
  },
  {
    "name": "Allergy to floor polish",
    "code": "OTHER_ALLERGY_TO_FLOOR_POLISH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to carpet shampoo",
    "code": "OTHER_ALLERGY_TO_CARPET_SHAMPOO",
    "category": "OTHER"
  },
  {
    "name": "Allergy to upholstery cleaner",
    "code": "OTHER_ALLERGY_TO_UPHOLSTERY_CLEANER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to leather conditioner",
    "code": "OTHER_ALLERGY_TO_LEATHER_CONDITIONER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wood polish",
    "code": "OTHER_ALLERGY_TO_WOOD_POLISH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to metal polish",
    "code": "OTHER_ALLERGY_TO_METAL_POLISH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to silver polish",
    "code": "OTHER_ALLERGY_TO_SILVER_POLISH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to brass cleaner",
    "code": "OTHER_ALLERGY_TO_BRASS_CLEANER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to rust remover fumes",
    "code": "OTHER_ALLERGY_TO_RUST_REMOVER_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to drain cleaner fumes",
    "code": "OTHER_ALLERGY_TO_DRAIN_CLEANER_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to toilet cleaner fumes",
    "code": "OTHER_ALLERGY_TO_TOILET_CLEANER_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to bleach fumes bathroom",
    "code": "OTHER_ALLERGY_TO_BLEACH_FUMES_BATHROOM",
    "category": "OTHER"
  },
  {
    "name": "Allergy to mould remover spray",
    "code": "OTHER_ALLERGY_TO_MOULD_REMOVER_SPRAY",
    "category": "OTHER"
  },
  {
    "name": "Allergy to window cleaner ammonia",
    "code": "OTHER_ALLERGY_TO_WINDOW_CLEANER_AMMONIA",
    "category": "OTHER"
  },
  {
    "name": "Allergy to furniture polish spray",
    "code": "OTHER_ALLERGY_TO_FURNITURE_POLISH_SPRAY",
    "category": "OTHER"
  },
  {
    "name": "Allergy to air purifier filter dust",
    "code": "OTHER_ALLERGY_TO_AIR_PURIFIER_FILTER_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to dehumidifier tank mould",
    "code": "OTHER_ALLERGY_TO_DEHUMIDIFIER_TANK_MOULD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to humidifier biocide",
    "code": "OTHER_ALLERGY_TO_HUMIDIFIER_BIOCIDE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to scented candle soot",
    "code": "OTHER_ALLERGY_TO_SCENTED_CANDLE_SOOT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to incense ash",
    "code": "OTHER_ALLERGY_TO_INCENSE_ASH",
    "category": "OTHER"
  },
  {
    "name": "Allergy to fireplace soot",
    "code": "OTHER_ALLERGY_TO_FIREPLACE_SOOT",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wood burner smoke",
    "code": "OTHER_ALLERGY_TO_WOOD_BURNER_SMOKE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to pellet stove dust",
    "code": "OTHER_ALLERGY_TO_PELLET_STOVE_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to oil heater fumes",
    "code": "OTHER_ALLERGY_TO_OIL_HEATER_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to paraffin heater fumes",
    "code": "OTHER_ALLERGY_TO_PARAFFIN_HEATER_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to electric heater dust burn",
    "code": "OTHER_ALLERGY_TO_ELECTRIC_HEATER_DUST_BURN",
    "category": "OTHER"
  },
  {
    "name": "Allergy to fan heater dust",
    "code": "OTHER_ALLERGY_TO_FAN_HEATER_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to radiator dust",
    "code": "OTHER_ALLERGY_TO_RADIATOR_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to loft insulation disturbance",
    "code": "OTHER_ALLERGY_TO_LOFT_INSULATION_DISTURBANCE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to cavity wall dust",
    "code": "OTHER_ALLERGY_TO_CAVITY_WALL_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to renovation dust general",
    "code": "OTHER_ALLERGY_TO_RENOVATION_DUST_GENERAL",
    "category": "OTHER"
  },
  {
    "name": "Allergy to plasterboard joint compound",
    "code": "OTHER_ALLERGY_TO_PLASTERBOARD_JOINT_COMPOUND",
    "category": "OTHER"
  },
  {
    "name": "Allergy to silicone sealant fumes",
    "code": "OTHER_ALLERGY_TO_SILICONE_SEALANT_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to expanding foam fumes",
    "code": "OTHER_ALLERGY_TO_EXPANDING_FOAM_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to wallpaper paste mould",
    "code": "OTHER_ALLERGY_TO_WALLPAPER_PASTE_MOULD",
    "category": "OTHER"
  },
  {
    "name": "Allergy to new paint off-gassing",
    "code": "OTHER_ALLERGY_TO_NEW_PAINT_OFF_GASSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to laminate flooring VOCs",
    "code": "OTHER_ALLERGY_TO_LAMINATE_FLOORING_VOCS",
    "category": "OTHER"
  },
  {
    "name": "Allergy to vinyl flooring plasticiser",
    "code": "OTHER_ALLERGY_TO_VINYL_FLOORING_PLASTICISER",
    "category": "OTHER"
  },
  {
    "name": "Allergy to carpet underlay fumes",
    "code": "OTHER_ALLERGY_TO_CARPET_UNDERLAY_FUMES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to mattress off-gassing",
    "code": "OTHER_ALLERGY_TO_MATTRESS_OFF_GASSING",
    "category": "OTHER"
  },
  {
    "name": "Allergy to new furniture formaldehyde",
    "code": "OTHER_ALLERGY_TO_NEW_FURNITURE_FORMALDEHYDE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to flat-pack adhesive",
    "code": "OTHER_ALLERGY_TO_FLAT_PACK_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to MDF dust",
    "code": "OTHER_ALLERGY_TO_MDF_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to plywood dust",
    "code": "OTHER_ALLERGY_TO_PLYWOOD_DUST",
    "category": "OTHER"
  },
  {
    "name": "Allergy to treated timber chemicals",
    "code": "OTHER_ALLERGY_TO_TREATED_TIMBER_CHEMICALS",
    "category": "OTHER"
  },
  {
    "name": "Bradykinin-mediated swelling",
    "code": "OTHER_BRADYKININ_MEDIATED_SWELLING",
    "category": "OTHER"
  },
  {
    "name": "Chronic idiopathic angioedema",
    "code": "OTHER_CHRONIC_IDIOPATHIC_ANGIOEDEMA",
    "category": "OTHER"
  },
  {
    "name": "Work-related rhinitis",
    "code": "OTHER_WORK_RELATED_RHINITIS",
    "category": "OTHER"
  },
  {
    "name": "Drug rash with eosinophilia history",
    "code": "OTHER_DRUG_RASH_WITH_EOSINOPHILIA_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Stevens-Johnson syndrome history",
    "code": "OTHER_STEVENS_JOHNSON_SYNDROME_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Toxic epidermal necrolysis history",
    "code": "OTHER_TOXIC_EPIDERMAL_NECROLYSIS_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Serum sickness-like reaction history",
    "code": "OTHER_SERUM_SICKNESS_LIKE_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Drug-induced lupus history",
    "code": "OTHER_DRUG_INDUCED_LUPUS_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "ACE inhibitor angioedema history",
    "code": "OTHER_ACE_INHIBITOR_ANGIOEDEMA_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Gelatin vaccine reaction",
    "code": "OTHER_GELATIN_VACCINE_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Bee venom immunotherapy reaction",
    "code": "OTHER_BEE_VENOM_IMMUNOTHERAPY_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Wasp venom immunotherapy reaction",
    "code": "OTHER_WASP_VENOM_IMMUNOTHERAPY_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Anaesthetic awareness history",
    "code": "OTHER_ANAESTHETIC_AWARENESS_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Coeliac disease (gluten-related)",
    "code": "OTHER_COELIAC_DISEASE_GLUTEN_RELATED",
    "category": "OTHER"
  },
  {
    "name": "Histamine in aged foods",
    "code": "OTHER_HISTAMINE_IN_AGED_FOODS",
    "category": "OTHER"
  },
  {
    "name": "Tyramine in aged cheese",
    "code": "OTHER_TYRAMINE_IN_AGED_CHEESE",
    "category": "OTHER"
  },
  {
    "name": "Nightshade sensitivity",
    "code": "OTHER_NIGHTSHADE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "FODMAP sensitivity",
    "code": "OTHER_FODMAP_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Lactose intolerance (non-immune)",
    "code": "OTHER_LACTOSE_INTOLERANCE_NON_IMMUNE",
    "category": "OTHER"
  },
  {
    "name": "Theobromine sensitivity",
    "code": "OTHER_THEOBROMINE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Human saliva contact",
    "code": "OTHER_HUMAN_SALIVA_CONTACT",
    "category": "OTHER"
  },
  {
    "name": "Tears contact sensitivity",
    "code": "OTHER_TEARS_CONTACT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Blood products sensitivity",
    "code": "OTHER_BLOOD_PRODUCTS_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Nickel-food cross reaction",
    "code": "OTHER_NICKEL_FOOD_CROSS_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to unspecified E-number duplicate ok skip",
    "code": "OTHER_ALLERGY_TO_UNSPECIFIED_E_NUMBER_DUPLICATE_OK_SKI",
    "category": "OTHER"
  },
  {
    "name": "Vibration from tools",
    "code": "OTHER_VIBRATION_FROM_TOOLS",
    "category": "OTHER"
  },
  {
    "name": "Pressure from tight clothing",
    "code": "OTHER_PRESSURE_FROM_TIGHT_CLOTHING",
    "category": "OTHER"
  },
  {
    "name": "Sun exposure through window glass",
    "code": "OTHER_SUN_EXPOSURE_THROUGH_WINDOW_GLASS",
    "category": "OTHER"
  },
  {
    "name": "Wind exposure face",
    "code": "OTHER_WIND_EXPOSURE_FACE",
    "category": "OTHER"
  },
  {
    "name": "Humidity trigger",
    "code": "OTHER_HUMIDITY_TRIGGER",
    "category": "OTHER"
  },
  {
    "name": "Barometric pressure change",
    "code": "OTHER_BAROMETRIC_PRESSURE_CHANGE",
    "category": "OTHER"
  },
  {
    "name": "Thunderstorm asthma pattern",
    "code": "OTHER_THUNDERSTORM_ASTHMA_PATTERN",
    "category": "OTHER"
  },
  {
    "name": "Temperature change trigger",
    "code": "OTHER_TEMPERATURE_CHANGE_TRIGGER",
    "category": "OTHER"
  },
  {
    "name": "Emotional stress trigger",
    "code": "OTHER_EMOTIONAL_STRESS_TRIGGER",
    "category": "OTHER"
  },
  {
    "name": "Menstrual cycle linked symptoms",
    "code": "OTHER_MENSTRUAL_CYCLE_LINKED_SYMPTOMS",
    "category": "OTHER"
  },
  {
    "name": "Pregnancy related allergy change",
    "code": "OTHER_PREGNANCY_RELATED_ALLERGY_CHANGE",
    "category": "OTHER"
  },
  {
    "name": "Menopause related sensitivity",
    "code": "OTHER_MENOPAUSE_RELATED_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Age related new sensitivity",
    "code": "OTHER_AGE_RELATED_NEW_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Immunotherapy in progress",
    "code": "OTHER_IMMUNOTHERAPY_IN_PROGRESS",
    "category": "OTHER"
  },
  {
    "name": "Desensitisation in progress",
    "code": "OTHER_DESENSITISATION_IN_PROGRESS",
    "category": "OTHER"
  },
  {
    "name": "Allergy clinic referral pending",
    "code": "OTHER_ALLERGY_CLINIC_REFERRAL_PENDING",
    "category": "OTHER"
  },
  {
    "name": "Skin prick test positive unspecified",
    "code": "OTHER_SKIN_PRICK_TEST_POSITIVE_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Blood IgE raised unspecified",
    "code": "OTHER_BLOOD_IGE_RAISED_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Component resolved diagnosis pending",
    "code": "OTHER_COMPONENT_RESOLVED_DIAGNOSIS_PENDING",
    "category": "OTHER"
  },
  {
    "name": "Mixed inhalant allergy",
    "code": "OTHER_MIXED_INHALANT_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Mixed food allergy",
    "code": "OTHER_MIXED_FOOD_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Mixed drug allergy",
    "code": "OTHER_MIXED_DRUG_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Polypharmacy allergy risk",
    "code": "OTHER_POLYPHARMACY_ALLERGY_RISK",
    "category": "OTHER"
  },
  {
    "name": "Allergy alert wristband worn",
    "code": "OTHER_ALLERGY_ALERT_WRISTBAND_WORN",
    "category": "OTHER"
  },
  {
    "name": "Allergy documented in care plan",
    "code": "OTHER_ALLERGY_DOCUMENTED_IN_CARE_PLAN",
    "category": "OTHER"
  },
  {
    "name": "Allergy documented on MAR",
    "code": "OTHER_ALLERGY_DOCUMENTED_ON_MAR",
    "category": "OTHER"
  },
  {
    "name": "Allergy cross checked at admission",
    "code": "OTHER_ALLERGY_CROSS_CHECKED_AT_ADMISSION",
    "category": "OTHER"
  },
  {
    "name": "Allergy reconciled at discharge",
    "code": "OTHER_ALLERGY_RECONCILED_AT_DISCHARGE",
    "category": "OTHER"
  },
  {
    "name": "Allergy discrepancy noted",
    "code": "OTHER_ALLERGY_DISCREPANCY_NOTED",
    "category": "OTHER"
  },
  {
    "name": "No known allergies (NKDA)",
    "code": "OTHER_NO_KNOWN_ALLERGIES_NKDA",
    "category": "OTHER"
  },
  {
    "name": "No known drug allergies (NKDA drugs)",
    "code": "OTHER_NO_KNOWN_DRUG_ALLERGIES_NKDA_DRUGS",
    "category": "OTHER"
  },
  {
    "name": "No known food allergies",
    "code": "OTHER_NO_KNOWN_FOOD_ALLERGIES",
    "category": "OTHER"
  },
  {
    "name": "Allergy to be confirmed",
    "code": "OTHER_ALLERGY_TO_BE_CONFIRMED",
    "category": "OTHER"
  },
  {
    "name": "Suspected allergy — avoid pending review",
    "code": "OTHER_SUSPECTED_ALLERGY_AVOID_PENDING_REVIEW",
    "category": "OTHER"
  },
  {
    "name": "Intolerance vs allergy unclear",
    "code": "OTHER_INTOLERANCE_VS_ALLERGY_UNCLEAR",
    "category": "OTHER"
  },
  {
    "name": "Non-IgE mediated food reaction",
    "code": "OTHER_NON_IGE_MEDIATED_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "IgE mediated food reaction",
    "code": "OTHER_IGE_MEDIATED_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Delayed food reaction",
    "code": "OTHER_DELAYED_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Immediate food reaction",
    "code": "OTHER_IMMEDIATE_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Contact food reaction",
    "code": "OTHER_CONTACT_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Inhaled food reaction",
    "code": "OTHER_INHALED_FOOD_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Injection related reaction history",
    "code": "OTHER_INJECTION_RELATED_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Transfusion reaction history",
    "code": "OTHER_TRANSFUSION_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Anaesthetic reaction history",
    "code": "OTHER_ANAESTHETIC_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Contrast reaction history",
    "code": "OTHER_CONTRAST_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Vaccine reaction history",
    "code": "OTHER_VACCINE_REACTION_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Antibiotic rash childhood",
    "code": "OTHER_ANTIBIOTIC_RASH_CHILDHOOD",
    "category": "OTHER"
  },
  {
    "name": "Childhood penicillin rash unconfirmed",
    "code": "OTHER_CHILDHOOD_PENICILLIN_RASH_UNCONFIRMED",
    "category": "OTHER"
  },
  {
    "name": "Penicillin allergy label — unverified",
    "code": "OTHER_PENICILLIN_ALLERGY_LABEL_UNVERIFIED",
    "category": "OTHER"
  },
  {
    "name": "ACE inhibitor cough vs allergy",
    "code": "OTHER_ACE_INHIBITOR_COUGH_VS_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Statin myalgia vs allergy",
    "code": "OTHER_STATIN_MYALGIA_VS_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Metformin GI upset vs allergy",
    "code": "OTHER_METFORMIN_GI_UPSET_VS_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Opioid nausea vs allergy",
    "code": "OTHER_OPIOID_NAUSEA_VS_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Local anaesthetic true allergy rare",
    "code": "OTHER_LOCAL_ANAESTHETIC_TRUE_ALLERGY_RARE",
    "category": "OTHER"
  },
  {
    "name": "Sulfonamide cross reactivity concern",
    "code": "OTHER_SULFONAMIDE_CROSS_REACTIVITY_CONCERN",
    "category": "OTHER"
  },
  {
    "name": "Beta lactam cross reactivity concern",
    "code": "OTHER_BETA_LACTAM_CROSS_REACTIVITY_CONCERN",
    "category": "OTHER"
  },
  {
    "name": "NSAID single drug allergy",
    "code": "OTHER_NSAID_SINGLE_DRUG_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "NSAID class allergy",
    "code": "OTHER_NSAID_CLASS_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Aspirin sensitive asthma",
    "code": "OTHER_ASPIRIN_SENSITIVE_ASTHMA",
    "category": "OTHER"
  },
  {
    "name": "Samter triad history",
    "code": "OTHER_SAMTER_TRIAD_HISTORY",
    "category": "OTHER"
  },
  {
    "name": "Urticaria pigmentosa",
    "code": "OTHER_URTICARIA_PIGMENTOSA",
    "category": "OTHER"
  },
  {
    "name": "Systemic mastocytosis concern",
    "code": "OTHER_SYSTEMIC_MASTOCYTOSIS_CONCERN",
    "category": "OTHER"
  },
  {
    "name": "Basophil activation test pending",
    "code": "OTHER_BASOPHIL_ACTIVATION_TEST_PENDING",
    "category": "OTHER"
  },
  {
    "name": "Oral challenge pending",
    "code": "OTHER_ORAL_CHALLENGE_PENDING",
    "category": "OTHER"
  },
  {
    "name": "Food elimination trial ongoing",
    "code": "OTHER_FOOD_ELIMINATION_TRIAL_ONGOING",
    "category": "OTHER"
  },
  {
    "name": "Reintroduction trial planned",
    "code": "OTHER_REINTRODUCTION_TRIAL_PLANNED",
    "category": "OTHER"
  },
  {
    "name": "Allergy action plan in place",
    "code": "OTHER_ALLERGY_ACTION_PLAN_IN_PLACE",
    "category": "OTHER"
  },
  {
    "name": "Adrenaline auto-injector prescribed",
    "code": "OTHER_ADRENALINE_AUTO_INJECTOR_PRESCRIBED",
    "category": "OTHER"
  },
  {
    "name": "Adrenaline auto-injector carried",
    "code": "OTHER_ADRENALINE_AUTO_INJECTOR_CARRIED",
    "category": "OTHER"
  },
  {
    "name": "Adrenaline auto-injector expired",
    "code": "OTHER_ADRENALINE_AUTO_INJECTOR_EXPIRED",
    "category": "OTHER"
  },
  {
    "name": "Antihistamine PRN for allergy",
    "code": "OTHER_ANTIHISTAMINE_PRN_FOR_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Steroid emergency pack for allergy",
    "code": "OTHER_STEROID_EMERGENCY_PACK_FOR_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Allergy bracelet metal nickel",
    "code": "OTHER_ALLERGY_BRACELET_METAL_NICKEL",
    "category": "OTHER"
  },
  {
    "name": "Medical ID necklace nickel",
    "code": "OTHER_MEDICAL_ID_NECKLACE_NICKEL",
    "category": "OTHER"
  },
  {
    "name": "Allergy tattoo alert",
    "code": "OTHER_ALLERGY_TATTOO_ALERT",
    "category": "OTHER"
  },
  {
    "name": "Phone medical ID allergy entry",
    "code": "OTHER_PHONE_MEDICAL_ID_ALLERGY_ENTRY",
    "category": "OTHER"
  },
  {
    "name": "DNACPR and allergy note",
    "code": "OTHER_DNACPR_AND_ALLERGY_NOTE",
    "category": "OTHER"
  },
  {
    "name": "Resuscitation allergy consideration",
    "code": "OTHER_RESUSCITATION_ALLERGY_CONSIDERATION",
    "category": "OTHER"
  },
  {
    "name": "Hospital red wristband allergy",
    "code": "OTHER_HOSPITAL_RED_WRISTBAND_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Community pharmacy allergy flag",
    "code": "OTHER_COMMUNITY_PHARMACY_ALLERGY_FLAG",
    "category": "OTHER"
  },
  {
    "name": "GP summary care record allergy",
    "code": "OTHER_GP_SUMMARY_CARE_RECORD_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "Summary care record discrepancy",
    "code": "OTHER_SUMMARY_CARE_RECORD_DISCREPANCY",
    "category": "OTHER"
  },
  {
    "name": "Emergency contact aware of allergy",
    "code": "OTHER_EMERGENCY_CONTACT_AWARE_OF_ALLERGY",
    "category": "OTHER"
  },
  {
    "name": "School allergy care plan",
    "code": "OTHER_SCHOOL_ALLERGY_CARE_PLAN",
    "category": "OTHER"
  },
  {
    "name": "Workplace allergy accommodation",
    "code": "OTHER_WORKPLACE_ALLERGY_ACCOMMODATION",
    "category": "OTHER"
  },
  {
    "name": "Travel allergy card",
    "code": "OTHER_TRAVEL_ALLERGY_CARD",
    "category": "OTHER"
  },
  {
    "name": "Airline meal allergy request",
    "code": "OTHER_AIRLINE_MEAL_ALLERGY_REQUEST",
    "category": "OTHER"
  },
  {
    "name": "Restaurant card allergy translation",
    "code": "OTHER_RESTAURANT_CARD_ALLERGY_TRANSLATION",
    "category": "OTHER"
  },
  {
    "name": "Allergy to airline meal trace",
    "code": "OTHER_ALLERGY_TO_AIRLINE_MEAL_TRACE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to hospital food trace",
    "code": "OTHER_ALLERGY_TO_HOSPITAL_FOOD_TRACE",
    "category": "OTHER"
  },
  {
    "name": "Allergy to care home food trace",
    "code": "OTHER_ALLERGY_TO_CARE_HOME_FOOD_TRACE",
    "category": "OTHER"
  },
  {
    "name": "Texture modified diet allergy risk",
    "code": "OTHER_TEXTURE_MODIFIED_DIET_ALLERGY_RISK",
    "category": "OTHER"
  },
  {
    "name": "Fortified food allergy risk",
    "code": "OTHER_FORTIFIED_FOOD_ALLERGY_RISK",
    "category": "OTHER"
  },
  {
    "name": "Supplement drink allergy risk",
    "code": "OTHER_SUPPLEMENT_DRINK_ALLERGY_RISK",
    "category": "OTHER"
  },
  {
    "name": "Herbal tea unspecified",
    "code": "OTHER_HERBAL_TEA_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Chinese herbal medicine unspecified",
    "code": "OTHER_CHINESE_HERBAL_MEDICINE_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Ayurvedic preparation unspecified",
    "code": "OTHER_AYURVEDIC_PREPARATION_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Home remedy unspecified",
    "code": "OTHER_HOME_REMEDY_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "Essential oil ingestion",
    "code": "OTHER_ESSENTIAL_OIL_INGESTION",
    "category": "OTHER"
  },
  {
    "name": "Essential oil topical unspecified",
    "code": "OTHER_ESSENTIAL_OIL_TOPICAL_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "CBD product unspecified",
    "code": "OTHER_CBD_PRODUCT_UNSPECIFIED",
    "category": "OTHER"
  },
  {
    "name": "THC product sensitivity",
    "code": "OTHER_THC_PRODUCT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Nicotine pouch sensitivity",
    "code": "OTHER_NICOTINE_POUCH_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Snus sensitivity",
    "code": "OTHER_SNUS_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Chewing tobacco sensitivity",
    "code": "OTHER_CHEWING_TOBACCO_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Betel nut sensitivity",
    "code": "OTHER_BETEL_NUT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Khat sensitivity",
    "code": "OTHER_KHAT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Poppy seed tea sensitivity",
    "code": "OTHER_POPPY_SEED_TEA_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Kava supplement sensitivity",
    "code": "OTHER_KAVA_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Kratom supplement sensitivity",
    "code": "OTHER_KRATOM_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Energy supplement sensitivity",
    "code": "OTHER_ENERGY_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Pre-workout supplement sensitivity",
    "code": "OTHER_PRE_WORKOUT_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Weight loss supplement sensitivity",
    "code": "OTHER_WEIGHT_LOSS_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Detox supplement sensitivity",
    "code": "OTHER_DETOX_SUPPLEMENT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Colon cleanse product sensitivity",
    "code": "OTHER_COLON_CLEANSE_PRODUCT_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Laxative herbal sensitivity",
    "code": "OTHER_LAXATIVE_HERBAL_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Senna tea sensitivity",
    "code": "OTHER_SENNA_TEA_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Slimming patch adhesive",
    "code": "OTHER_SLIMMING_PATCH_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Nicotine lozenge flavour",
    "code": "OTHER_NICOTINE_LOZENGE_FLAVOUR",
    "category": "OTHER"
  },
  {
    "name": "Nicotine inhalator sensitivity",
    "code": "OTHER_NICOTINE_INHALATOR_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "HRT patch adhesive",
    "code": "OTHER_HRT_PATCH_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Contraceptive patch adhesive",
    "code": "OTHER_CONTRACEPTIVE_PATCH_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Contraceptive implant site reaction",
    "code": "OTHER_CONTRACEPTIVE_IMPLANT_SITE_REACTION",
    "category": "OTHER"
  },
  {
    "name": "Copper IUD sensitivity",
    "code": "OTHER_COPPER_IUD_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Latex condom sensitivity",
    "code": "OTHER_LATEX_CONDOM_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Polyisoprene condom sensitivity",
    "code": "OTHER_POLYISOPRENE_CONDOM_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Dental night guard material",
    "code": "OTHER_DENTAL_NIGHT_GUARD_MATERIAL",
    "category": "OTHER"
  },
  {
    "name": "Sleep apnea dental device",
    "code": "OTHER_SLEEP_APNEA_DENTAL_DEVICE",
    "category": "OTHER"
  },
  {
    "name": "Mandibular advancement device",
    "code": "OTHER_MANDIBULAR_ADVANCEMENT_DEVICE",
    "category": "OTHER"
  },
  {
    "name": "Tongue retaining device",
    "code": "OTHER_TONGUE_RETAINING_DEVICE",
    "category": "OTHER"
  },
  {
    "name": "Nasal dilator sensitivity",
    "code": "OTHER_NASAL_DILATOR_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Nasal strip adhesive",
    "code": "OTHER_NASAL_STRIP_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Mouth tape sensitivity",
    "code": "OTHER_MOUTH_TAPE_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Chin strap CPAP sensitivity",
    "code": "OTHER_CHIN_STRAP_CPAP_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Eye mask sleep sensitivity",
    "code": "OTHER_EYE_MASK_SLEEP_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Ear plug latex",
    "code": "OTHER_EAR_PLUG_LATEX",
    "category": "OTHER"
  },
  {
    "name": "Ear plug silicone",
    "code": "OTHER_EAR_PLUG_SILICONE",
    "category": "OTHER"
  },
  {
    "name": "Hearing protection foam",
    "code": "OTHER_HEARING_PROTECTION_FOAM",
    "category": "OTHER"
  },
  {
    "name": "Safety goggles strap",
    "code": "OTHER_SAFETY_GOGGLES_STRAP",
    "category": "OTHER"
  },
  {
    "name": "Hard hat padding",
    "code": "OTHER_HARD_HAT_PADDING",
    "category": "OTHER"
  },
  {
    "name": "High vis vest fabric",
    "code": "OTHER_HIGH_VIS_VEST_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Reflective tape adhesive",
    "code": "OTHER_REFLECTIVE_TAPE_ADHESIVE",
    "category": "OTHER"
  },
  {
    "name": "Safety boot rubber",
    "code": "OTHER_SAFETY_BOOT_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Steel toe cap pressure",
    "code": "OTHER_STEEL_TOE_CAP_PRESSURE",
    "category": "OTHER"
  },
  {
    "name": "Knee pad foam",
    "code": "OTHER_KNEE_PAD_FOAM",
    "category": "OTHER"
  },
  {
    "name": "Back support brace latex",
    "code": "OTHER_BACK_SUPPORT_BRACE_LATEX",
    "category": "OTHER"
  },
  {
    "name": "Compression glove fabric",
    "code": "OTHER_COMPRESSION_GLOVE_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Splint padding",
    "code": "OTHER_SPLINT_PADDING",
    "category": "OTHER"
  },
  {
    "name": "Cast liner sensitivity",
    "code": "OTHER_CAST_LINER_SENSITIVITY",
    "category": "OTHER"
  },
  {
    "name": "Fibreglass cast dust",
    "code": "OTHER_FIBREGLASS_CAST_DUST",
    "category": "OTHER"
  },
  {
    "name": "Plaster cast dust",
    "code": "OTHER_PLASTER_CAST_DUST",
    "category": "OTHER"
  },
  {
    "name": "Waterproof cast cover latex",
    "code": "OTHER_WATERPROOF_CAST_COVER_LATEX",
    "category": "OTHER"
  },
  {
    "name": "Crutch pad rubber",
    "code": "OTHER_CRUTCH_PAD_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Walking stick ferrule rubber",
    "code": "OTHER_WALKING_STICK_FERRULE_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Tripod stick rubber",
    "code": "OTHER_TRIPOD_STICK_RUBBER",
    "category": "OTHER"
  },
  {
    "name": "Mobility scooter seat vinyl",
    "code": "OTHER_MOBILITY_SCOOTER_SEAT_VINYL",
    "category": "OTHER"
  },
  {
    "name": "Wheelchair lap belt fabric",
    "code": "OTHER_WHEELCHAIR_LAP_BELT_FABRIC",
    "category": "OTHER"
  },
  {
    "name": "Seat belt nickel buckle",
    "code": "OTHER_SEAT_BELT_NICKEL_BUCKLE",
    "category": "OTHER"
  },
  {
    "name": "Car seat buckle nickel",
    "code": "OTHER_CAR_SEAT_BUCKLE_NICKEL",
    "category": "OTHER"
  }
] as AllergyCatalogSeedEntry[];
