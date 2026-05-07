// Word lists for firehose classification dataset
// 100 common words per category

const WORD_LISTS = {
  birds: [
    'robin', 'sparrow', 'eagle', 'hawk', 'owl', 'pigeon', 'dove', 'crow', 'raven', 'magpie',
    'jay', 'finch', 'wren', 'thrush', 'warbler', 'swallow', 'swift', 'martin', 'starling', 'blackbird',
    'heron', 'egret', 'crane', 'stork', 'ibis', 'flamingo', 'pelican', 'cormorant', 'gannet', 'albatross',
    'penguin', 'puffin', 'guillemot', 'tern', 'gull', 'plover', 'sandpiper', 'curlew', 'snipe', 'woodcock',
    'pheasant', 'partridge', 'quail', 'grouse', 'turkey', 'peacock', 'guinea fowl', 'ostrich', 'emu', 'rhea',
    'kiwi', 'cassowary', 'toucan', 'parrot', 'macaw', 'cockatoo', 'parakeet', 'lovebird', 'budgerigar', 'cockatiel',
    'kingfisher', 'bee-eater', 'hoopoe', 'roller', 'hornbill', 'woodpecker', 'nuthatch', 'treecreeper', 'waxwing', 'redwing',
    'fieldfare', 'redstart', 'wheatear', 'stonechat', 'linnet', 'goldfinch', 'siskin', 'bullfinch', 'crossbill', 'bunting',
    'wagtail', 'pipit', 'lark', 'nightingale', 'cuckoo', 'swift', 'nightjar', 'tawny owl', 'barn owl', 'little owl',
    'kestrel', 'merlin', 'hobby', 'peregrine', 'osprey', 'buzzard', 'kite', 'harrier', 'sparrowhawk', 'goshawk',
  ],

  reptiles: [
    'python', 'boa', 'anaconda', 'cobra', 'mamba', 'viper', 'rattlesnake', 'copperhead', 'cottonmouth', 'coral snake',
    'king snake', 'garter snake', 'gopher snake', 'bull snake', 'racer', 'whipsnake', 'ribbon snake', 'hognose snake', 'milk snake', 'pine snake',
    'iguana', 'gecko', 'chameleon', 'anole', 'skink', 'monitor', 'Komodo dragon', 'bearded dragon', 'blue-tongue', 'frilled lizard',
    'horned lizard', 'gecko', 'tokay', 'leopard gecko', 'fat-tail gecko', 'day gecko', 'crested gecko', 'gargoyle gecko', 'alligator lizard', 'gila monster',
    'alligator', 'crocodile', 'gharial', 'caiman', 'saltwater crocodile', 'Nile crocodile', 'American alligator', 'Chinese alligator', 'dwarf crocodile', 'mugger',
    'leatherback', 'loggerhead', 'green turtle', 'hawksbill', 'flatback', 'ridley', 'box turtle', 'painted turtle', 'red-eared slider', 'snapping turtle',
    'tortoise', 'gopher tortoise', 'desert tortoise', 'aldabra', 'galapagos', 'Greek tortoise', 'Hermann tortoise', 'Russian tortoise', 'leopard tortoise', 'sulcata',
    'basilisk', 'collared lizard', 'fence lizard', 'side-blotched', 'zebra-tail', 'earless lizard', 'sandfish', 'uromastyx', 'water dragon', 'sail-fin lizard',
    'tuatara', 'worm lizard', 'glass lizard', 'legless lizard', 'night lizard', 'xantusia', 'teiid', 'whiptail', 'six-lined racerunner', 'rainbow whiptail',
    'flying dragon', 'thorny devil', 'moloch', 'leaf-tailed gecko', 'satanic leaf gecko', 'armadillo lizard', 'sungazer', 'plated lizard', 'girdle-tail', 'girdled lizard',
  ],

  mammals: [
    'dog', 'cat', 'horse', 'cow', 'pig', 'sheep', 'goat', 'rabbit', 'hamster', 'gerbil',
    'mouse', 'rat', 'guinea pig', 'chinchilla', 'ferret', 'mink', 'otter', 'beaver', 'muskrat', 'vole',
    'deer', 'elk', 'moose', 'reindeer', 'caribou', 'bison', 'buffalo', 'antelope', 'gazelle', 'impala',
    'lion', 'tiger', 'leopard', 'cheetah', 'jaguar', 'cougar', 'lynx', 'bobcat', 'ocelot', 'serval',
    'wolf', 'fox', 'coyote', 'jackal', 'dingo', 'hyena', 'aardwolf', 'mongoose', 'meerkat', 'civet',
    'bear', 'polar bear', 'grizzly', 'black bear', 'panda', 'sun bear', 'sloth bear', 'spectacled bear', 'wolverine', 'badger',
    'elephant', 'rhinoceros', 'hippopotamus', 'giraffe', 'zebra', 'okapi', 'tapir', 'warthog', 'peccary', 'capybara',
    'gorilla', 'chimpanzee', 'orangutan', 'gibbon', 'baboon', 'mandrill', 'macaque', 'marmoset', 'lemur', 'tarsier',
    'whale', 'dolphin', 'porpoise', 'seal', 'sea lion', 'walrus', 'manatee', 'dugong', 'narwhal', 'beluga',
    'bat', 'hedgehog', 'mole', 'shrew', 'opossum', 'kangaroo', 'koala', 'wombat', 'platypus', 'echidna',
  ],

  fruits: [
    'apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'cherry', 'peach',
    'pear', 'plum', 'apricot', 'nectarine', 'mango', 'papaya', 'pineapple', 'kiwi', 'watermelon', 'cantaloupe',
    'honeydew', 'lemon', 'lime', 'grapefruit', 'tangerine', 'clementine', 'mandarin', 'pomelo', 'kumquat', 'yuzu',
    'fig', 'date', 'prune', 'raisin', 'currant', 'gooseberry', 'elderberry', 'cranberry', 'lingonberry', 'boysenberry',
    'loganberry', 'mulberry', 'pomegranate', 'guava', 'passion fruit', 'dragon fruit', 'star fruit', 'jackfruit', 'durian', 'lychee',
    'rambutan', 'longan', 'mangosteen', 'soursop', 'cherimoya', 'feijoa', 'persimmon', 'quince', 'medlar', 'loquat',
    'tamarind', 'breadfruit', 'plantain', 'coconut', 'avocado', 'tomato', 'olive', 'pumpkin', 'squash', 'cucumber',
    'zucchini', 'eggplant', 'bell pepper', 'chili pepper', 'jalapeño', 'habanero', 'serrano', 'cayenne', 'paprika pepper', 'poblano',
    'ackee', 'bilberry', 'cloudberry', 'salal berry', 'serviceberry', 'barberry', 'sea buckthorn', 'cornelian cherry', 'hackberry', 'jujube',
    'crab apple', 'wild strawberry', 'blood orange', 'cara cara', 'ugli fruit', 'finger lime', 'Buddha hand', 'bitter melon', 'horned melon', 'miracle berry',
  ],

  vegetables: [
    'carrot', 'broccoli', 'spinach', 'kale', 'lettuce', 'cabbage', 'cauliflower', 'Brussels sprout', 'celery', 'asparagus',
    'green bean', 'pea', 'corn', 'potato', 'sweet potato', 'yam', 'beet', 'turnip', 'parsnip', 'radish',
    'onion', 'garlic', 'leek', 'shallot', 'chive', 'scallion', 'fennel', 'artichoke', 'bok choy', 'napa cabbage',
    'Swiss chard', 'collard green', 'mustard green', 'arugula', 'watercress', 'endive', 'radicchio', 'frisée', 'escarole', 'dandelion',
    'mushroom', 'portobello', 'shiitake', 'oyster mushroom', 'cremini', 'button mushroom', 'chanterelle', 'morel', 'porcini', 'enoki',
    'pumpkin', 'butternut squash', 'acorn squash', 'spaghetti squash', 'delicata squash', 'hubbard squash', 'kabocha', 'zucchini', 'yellow squash', 'patty pan',
    'bell pepper', 'eggplant', 'cucumber', 'tomato', 'tomatillo', 'okra', 'lotus root', 'water chestnut', 'bamboo shoot', 'bean sprout',
    'lentil', 'chickpea', 'black bean', 'kidney bean', 'pinto bean', 'navy bean', 'fava bean', 'edamame', 'lima bean', 'snap pea',
    'rutabaga', 'kohlrabi', 'celeriac', 'salsify', 'jicama', 'daikon', 'horseradish', 'wasabi', 'turmeric', 'ginger',
    'sweet corn', 'baby corn', 'romanesco', 'purple cabbage', 'savoy cabbage', 'Tuscan kale', 'curly kale', 'dinosaur kale', 'microgreens', 'sprouts',
  ],
};
