// https://gist.github.com/afriggeri/1266756

const adjs = [
	'abrasive',
	'aged',
	'ancient',
	'angry',
	'antique',
	'artsy',
	'autumn',
	'average',
	'billowing',
	'bitter',
	'black',
	'blue',
	'bold',
	'brave',
	'calm',
	'cheeky',
	'clean',
	'cold',
	'complex',
	'cool',
	'creative',
	'crimson',
	'damp',
	'dark',
	'dawn',
	'deep',
	'defiant',
	'delicate',
	'divine',
	'dreary',
	'dry',
	'dull',
	'empty',
	'evil',
	'falling',
	'fancy',
	'fantastic',
	'fast',
	'fierce',
	'floral',
	'fragrant',
	'fried',
	'frosty',
	'funny',
	'gentle',
	'green',
	'grilled',
	'grumpy',
	'happy',
	'haunted',
	'hidden',
	'holy',
	'humble',
	'icy',
	'jolly',
	'kind',
	'large',
	'late',
	'lazy',
	'lingering',
	'little',
	'lively',
	'long',
	'mean',
	'medieval',
	'misty',
	'morning',
	'muddy',
	'nameless',
	'nice',
	'old',
	'patient',
	'perfect',
	'plain',
	'pleasant',
	'polished',
	'precise',
	'pretty',
	'proud',
	'purple',
	'quiet',
	'red',
	'restless',
	'rough',
	'round',
	'sentient',
	'shy',
	'silent',
	'silly',
	'simple',
	'sinister',
	'sleek',
	'slim',
	'slow',
	'small',
	'smart',
	'smooth',
	'snappy',
	'sneaky',
	'snowy',
	'solitary',
	'sparkling',
	'spring',
	'square',
	'steamed',
	'still',
	'stormy',
	'strange',
	'summer',
	'tenacious',
	'tense',
	'twilight',
	'vast',
	'wandering',
	'weathered',
	'white',
	'wicked',
	'wide',
	'wild',
	'winter',
	'wispy',
	'withered',
	'young',
];
const nouns = [
	'afternoon',
	'antelope',
	'apple',
	'beach',
	'bird',
	'bramble',
	'breakfast',
	'breeze',
	'bridge',
	'brook',
	'bush',
	'butterfly',
	'cactus',
	'car',
	'castle',
	'cherry',
	'cloud',
	'coffee',
	'cucumber',
	'darkness',
	'dawn',
	'desert',
	'dew',
	'dinner',
	'doorway',
	'dream',
	'drizzle',
	'dust',
	'engine',
	'feather',
	'field',
	'fin',
	'fire',
	'firefly',
	'fish',
	'flower',
	'fog',
	'forest',
	'frog',
	'frost',
	'glade',
	'glitter',
	'grass',
	'guard',
	'hail',
	'ham',
	'haze',
	'hill',
	'hour',
	'house',
	'hurricane',
	'jam',
	'lake',
	'leaf',
	'madness',
	'meadow',
	'mine',
	'mist',
	'monster',
	'moon',
	'morning',
	'mountain',
	'night',
	'notebook',
	'pancake',
	'paper',
	'photo',
	'picture',
	'pie',
	'pine',
	'plane',
	'pond',
	'potato',
	'rain',
	'rainfall',
	'ranch',
	'resonance',
	'river',
	'road',
	'robot',
	'rock',
	'scout',
	'sea',
	'shadow',
	'shape',
	'silence',
	'sky',
	'smoke',
	'snow',
	'snowflake',
	'sound',
	'spider',
	'star',
	'starfish',
	'stone',
	'stream',
	'street',
	'summer',
	'sun',
	'sunset',
	'surf',
	'table',
	'tea',
	'thunder',
	'tile',
	'time',
	'tornado',
	'tree',
	'tundra',
	'turnip',
	'violet',
	'voice',
	'water',
	'waterfall',
	'wave',
	'whirlwind',
	'wildflower',
	'wind',
	'wood',
	'zombie',
	'zone',
];

const adjsCount = adjs.length;
const nounsCount = nouns.length;
const bigNumber = Math.pow(2, 12);

export const generate = () => {
	const rnd = Math.floor(Math.random() * bigNumber);
	// tslint:disable-next-line:no-bitwise
	return `${adjs[(rnd >> 6) % adjsCount]}-${nouns[rnd % nounsCount]}`;
};
