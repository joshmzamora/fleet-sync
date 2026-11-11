/**
 * UT Dallas campus locations for the independent campus-map class project.
 *
 * Names and campus building codes were cross-checked against UT Dallas's campus
 * map and parking map. Most coordinates are OpenStreetMap feature points or mapped
 * building/area centroids (retrieved through Mapcarta). A few buildings missing
 * from the point dataset use approximate centers inferred from the campus map,
 * individually labeled below. None of these positions are surveyed entrances.
 *
 * Attribution: © OpenStreetMap contributors, ODbL 1.0.
 * https://www.openstreetmap.org/copyright
 * https://mapcarta.com/ (OSM feature identifiers on individual location pages)
 * https://bpb-us-e2.wpmucdn.com/sites.utdallas.edu/dist/c/1062/files/2024/05/campus-map-2024.pdf
 * https://services.utdallas.edu/download/Parking_Map.pdf
 *
 * This is a curated subset of features, not a real-time source for building
 * openings, accessible entrances, road closures, or parking availability.
 */

export type CampusLocation = {
  id: string;
  name: string;
  code?: string;
  category:
    | 'Academic & Administrative'
    | 'Construction'
    | 'Dining'
    | 'Housing'
    | 'Landmarks'
    | 'Parking & Transportation'
    | 'Services'
    | 'Skybridge'
    | 'Sports Facilities';
  lat: number;
  lng: number;
  description?: string;
  address?: string;
};

export const locations: CampusLocation[] = [
  // Academic and administrative buildings
  {
    id: 'ecsw',
    name: 'Engineering and Computer Science West',
    code: 'ECSW',
    category: 'Academic & Administrative',
    lat: 32.9861,
    lng: -96.75183,
    description: 'Approximate building center, estimated using the UT Dallas campus map.',
  },
  {
    id: 'jo',
    name: 'Erik Jonsson Academic Center',
    code: 'JO',
    category: 'Academic & Administrative',
    lat: 32.98855,
    lng: -96.7480,
    description: 'Approximate building center, estimated using the UT Dallas campus map.',
  },
  {
    id: 'ab',
    name: 'Activity Center',
    code: 'AB',
    category: 'Sports Facilities',
    lat: 32.98525,
    lng: -96.74945,
    description: 'Approximate building center, estimated using the UT Dallas campus map.',
  },
  {
    id: 'gr',
    name: 'Cecil H. Green Hall',
    code: 'GR',
    category: 'Academic & Administrative',
    lat: 32.98844,
    lng: -96.74745,
    description: 'Approximate building center, estimated using the UT Dallas campus map.',
  },
  {
    id: 'vcb',
    name: 'Visitor Center and University Bookstore',
    code: 'VCB',
    category: 'Services',
    lat: 32.98483,
    lng: -96.74945,
    description: 'Location shown on the 2024 campus schematic. Visitor services may move; check the official visitor information before arriving.',
  },
  {
    id: 'ecss',
    name: 'Engineering and Computer Science South',
    code: 'ECSS',
    category: 'Academic & Administrative',
    lat: 32.98616,
    lng: -96.75036,
  },
  {
    id: 'ecsn',
    name: 'Engineering and Computer Science North',
    code: 'ECSN',
    category: 'Academic & Administrative',
    lat: 32.98688,
    lng: -96.75036,
  },
  {
    id: 'mc',
    name: 'Eugene McDermott Library',
    code: 'MC',
    category: 'Academic & Administrative',
    lat: 32.98693,
    lng: -96.74763,
  },
  {
    id: 'atc',
    name: "Edith O'Donnell Arts and Technology Building",
    code: 'ATC',
    category: 'Academic & Administrative',
    lat: 32.98605,
    lng: -96.74755,
  },
  {
    id: 'phy',
    name: 'Physics Building',
    code: 'PHY',
    category: 'Academic & Administrative',
    lat: 32.98945,
    lng: -96.75037,
  },
  {
    id: 'pha',
    name: 'Physics Annex',
    code: 'PHA',
    category: 'Academic & Administrative',
    lat: 32.98952,
    lng: -96.74993,
  },
  {
    id: 'fo',
    name: 'Founders Building',
    code: 'FO',
    category: 'Academic & Administrative',
    lat: 32.98769,
    lng: -96.74905,
  },
  {
    id: 'fa',
    name: 'Founders West Annex',
    code: 'FA',
    category: 'Academic & Administrative',
    lat: 32.9877,
    lng: -96.7499,
  },
  {
    id: 'fn',
    name: 'Founders North',
    code: 'FN',
    category: 'Academic & Administrative',
    lat: 32.98813,
    lng: -96.74935,
  },
  {
    id: 'be',
    name: 'Lloyd V. Berkner Hall',
    code: 'BE',
    category: 'Academic & Administrative',
    lat: 32.9877,
    lng: -96.75046,
  },
  {
    id: 'slc',
    name: 'Science Learning Center',
    code: 'SLC',
    category: 'Academic & Administrative',
    lat: 32.98819,
    lng: -96.7504,
  },
  {
    id: 'sci',
    name: 'Sciences Building',
    code: 'SCI',
    category: 'Academic & Administrative',
    lat: 32.9887,
    lng: -96.75032,
  },
  {
    id: 'th',
    name: 'University Theatre',
    code: 'TH',
    category: 'Academic & Administrative',
    lat: 32.98842,
    lng: -96.74871,
  },
  {
    id: 'cb',
    name: 'Classroom Building',
    code: 'CB',
    category: 'Academic & Administrative',
    lat: 32.9897,
    lng: -96.74934,
  },
  {
    id: 'nb',
    name: 'North Office Building',
    code: 'NB',
    category: 'Academic & Administrative',
    lat: 32.99008,
    lng: -96.74938,
  },
  {
    id: 'bsb',
    name: 'Bioengineering and Sciences Building',
    code: 'BSB',
    category: 'Academic & Administrative',
    lat: 32.99152,
    lng: -96.75003,
  },
  {
    id: 'rl',
    name: 'Natural Science and Engineering Research Laboratory',
    code: 'RL',
    category: 'Academic & Administrative',
    lat: 32.99234,
    lng: -96.75034,
  },
  {
    id: 'cr',
    name: 'Callier Center for Communication Disorders',
    code: 'CR',
    category: 'Academic & Administrative',
    lat: 32.99236,
    lng: -96.7487,
    address: '2895 Facilities Way, Richardson, TX 75080',
  },
  {
    id: 'spn',
    name: 'Synergy Park North',
    code: 'SPN',
    category: 'Academic & Administrative',
    lat: 32.99394,
    lng: -96.75224,
  },
  {
    id: 'waac',
    name: 'Waterview Academic and Administrative Center',
    code: 'WAAC',
    category: 'Academic & Administrative',
    lat: 32.99039,
    lng: -96.75804,
    address: '17787 Waterview Parkway, Richardson, TX 75080',
  },
  {
    id: 'wstc',
    name: 'Waterview Science and Technology Center',
    code: 'WSTC',
    category: 'Academic & Administrative',
    lat: 32.992,
    lng: -96.75742,
    address: '17919 Waterview Parkway, Richardson, TX 75080',
  },
  {
    id: 'apc',
    name: "Edith and Peter O'Donnell Jr. Athenaeum",
    code: 'APC',
    category: 'Academic & Administrative',
    lat: 32.98381,
    lng: -96.74726,
    address: '777 Loop Road, Richardson, TX 75080',
  },
  {
    id: 'jsom',
    name: 'Naveen Jindal School of Management',
    code: 'JSOM',
    category: 'Academic & Administrative',
    lat: 32.98463,
    lng: -96.7478,
    description: 'Marker at the mapped school information point.',
  },
  {
    id: 'dga',
    name: 'Davidson-Gundy Alumni Center',
    code: 'DGA',
    category: 'Academic & Administrative',
    lat: 32.98605,
    lng: -96.74652,
  },
  {
    id: 'ml2',
    name: 'Modular Lab 2',
    code: 'ML2',
    category: 'Academic & Administrative',
    lat: 32.98687,
    lng: -96.7533,
  },
  {
    id: 'ml1',
    name: 'Modular Lab 1',
    code: 'ML1',
    category: 'Academic & Administrative',
    lat: 32.98686,
    lng: -96.75262,
  },
  {
    id: 'hh',
    name: 'Karl Hoblitzelle Hall',
    code: 'HH',
    category: 'Academic & Administrative',
    lat: 32.98695,
    lng: -96.75164,
  },
  {
    id: 'ssa',
    name: 'Student Services Building Addition',
    code: 'SSA',
    category: 'Services',
    lat: 32.98603,
    lng: -96.74939,
  },
  {
    id: 'ssb',
    name: 'Student Services Building',
    code: 'SSB',
    category: 'Services',
    lat: 32.9859,
    lng: -96.74884,
  },
  {
    id: 'su',
    name: 'Student Union',
    code: 'SU',
    category: 'Services',
    lat: 32.98666,
    lng: -96.74888,
  },
  {
    id: 'ep',
    name: 'Energy Plant',
    code: 'EP',
    category: 'Services',
    lat: 32.98855,
    lng: -96.75124,
  },
  {
    id: 'visitor-center-north',
    name: 'UT Dallas Visitor Information on Rutford Avenue',
    category: 'Services',
    lat: 32.99046,
    lng: -96.75081,
    description: 'Visitor information location near the northern residence halls. The UT Dallas visitor directions page identifies 2830 Rutford Avenue as its visitor center address.',
    address: '2830 Rutford Avenue, Richardson, TX 75080',
  },
  {
    id: 'housing-mail-phase-7',
    name: 'University Village Phase 7 Mail',
    category: 'Services',
    lat: 32.98723,
    lng: -96.75566,
  },
  {
    id: 'housing-mail-phase-6',
    name: 'University Village Phase 6 Mail',
    category: 'Services',
    lat: 32.98807,
    lng: -96.75445,
  },

  // Residential halls and apartment communities
  {
    id: 'rha',
    name: 'Andromeda Hall',
    code: 'RHA',
    category: 'Housing',
    lat: 32.99024,
    lng: -96.75478,
  },
  {
    id: 'rhc',
    name: 'Capella Hall',
    code: 'RHC',
    category: 'Housing',
    lat: 32.99124,
    lng: -96.7518,
  },
  {
    id: 'rhh',
    name: 'Helix Hall',
    code: 'RHH',
    category: 'Housing',
    lat: 32.99019,
    lng: -96.75294,
  },
  {
    id: 'rhs',
    name: 'Sirius Hall',
    code: 'RHS',
    category: 'Housing',
    lat: 32.99019,
    lng: -96.75169,
  },
  {
    id: 'rhv',
    name: 'Vega Hall',
    code: 'RHV',
    category: 'Housing',
    lat: 32.99134,
    lng: -96.75429,
  },
  {
    id: 'canyon-creek-north',
    name: 'Canyon Creek Heights North',
    code: 'CH7',
    category: 'Housing',
    lat: 32.98161,
    lng: -96.75535,
  },
  {
    id: 'uv-phase-8',
    name: 'University Village Phase 8',
    category: 'Housing',
    lat: 32.98907,
    lng: -96.7533,
  },
  {
    id: 'uv-phase-8a',
    name: 'University Village Phase 8A',
    category: 'Housing',
    lat: 32.98911,
    lng: -96.7554,
  },
  {
    id: 'uv-phase-3',
    name: 'University Village Phase 3',
    category: 'Housing',
    lat: 32.98482,
    lng: -96.75261,
  },

  // Campus food and retail
  {
    id: 'dhw',
    name: 'Dining Hall West',
    code: 'DHW',
    category: 'Dining',
    lat: 32.99014,
    lng: -96.75452,
    description: 'Approximate dining hall center near the residence halls.',
  },
  {
    id: 'su-food-court',
    name: 'Student Union Food Court',
    category: 'Dining',
    lat: 32.98677,
    lng: -96.74941,
  },
  {
    id: 'market-dhw',
    name: 'The Market at Dining Hall West',
    category: 'Dining',
    lat: 32.98996,
    lng: -96.75444,
  },
  {
    id: 'market-jsom',
    name: 'The Market at JSOM',
    category: 'Dining',
    lat: 32.98488,
    lng: -96.74787,
  },

  // Parking garages, lots, and transit hubs
  {
    id: 'ps1',
    name: 'Parking Structure 1',
    code: 'PS1',
    category: 'Parking & Transportation',
    lat: 32.98599,
    lng: -96.74546,
  },
  {
    id: 'ps3',
    name: 'Parking Structure 3',
    code: 'PS3',
    category: 'Parking & Transportation',
    lat: 32.99023,
    lng: -96.75034,
  },
  {
    id: 'ps4',
    name: 'Parking Structure 4',
    code: 'PS4',
    category: 'Parking & Transportation',
    lat: 32.98613,
    lng: -96.753,
  },
  {
    id: 'lot-f',
    name: 'Lot F',
    code: 'F',
    category: 'Parking & Transportation',
    lat: 32.98427,
    lng: -96.7493,
  },
  {
    id: 'residence-lot-nw',
    name: 'Residence Lot North West',
    category: 'Parking & Transportation',
    lat: 32.9914,
    lng: -96.75519,
  },
  {
    id: 'parking-office',
    name: 'UT Dallas Parking and Transportation Office',
    category: 'Parking & Transportation',
    lat: 32.99049,
    lng: -96.75034,
  },
  {
    id: 'university-transit-center',
    name: 'University Transit Center',
    category: 'Parking & Transportation',
    lat: 32.9839,
    lng: -96.74955,
    description: 'UT Dallas bus transit connection.',
  },
  {
    id: 'dart-silver-line',
    name: 'DART Silver Line: UT Dallas Station',
    category: 'Parking & Transportation',
    lat: 32.99708,
    lng: -96.74934,
    description: 'Regional commuter-rail station north of the main campus.',
  },

  // Outdoor gathering spots and artwork
  {
    id: 'chess-plaza',
    name: 'Chess Plaza',
    category: 'Landmarks',
    lat: 32.98563,
    lng: -96.74827,
  },
  {
    id: 'ecsw-courtyard',
    name: 'ECSW Courtyard',
    category: 'Landmarks',
    lat: 32.9861,
    lng: -96.75171,
  },
  {
    id: 'the-lawn',
    name: 'The Lawn',
    category: 'Landmarks',
    lat: 32.98582,
    lng: -96.7464,
  },
  {
    id: 'bert-moore-courtyard',
    name: 'Bert Moore Courtyard',
    category: 'Landmarks',
    lat: 32.99211,
    lng: -96.74856,
  },
  {
    id: 'utd-mural',
    name: 'UTD Mural',
    category: 'Landmarks',
    lat: 32.98464,
    lng: -96.74743,
  },
  {
    id: 'bent-tau-beta-pi',
    name: 'The Bent of Tau Beta Pi',
    category: 'Landmarks',
    lat: 32.98664,
    lng: -96.75085,
  },
  {
    id: 'landscape-enhancement',
    name: 'Campus Landscape Enhancement Phase III',
    category: 'Landmarks',
    lat: 32.98732,
    lng: -96.75096,
  },

  // Recreation facilities
  {
    id: 'rcw',
    name: 'Recreation Center West',
    code: 'RCW',
    category: 'Sports Facilities',
    lat: 32.99001,
    lng: -96.75532,
  },
  {
    id: 'phase-8-pool',
    name: 'University Village Phase 8 Pool',
    category: 'Sports Facilities',
    lat: 32.98901,
    lng: -96.75339,
  },
  {
    id: 'phase-3-pool',
    name: 'University Village Phase 3 Pool',
    category: 'Sports Facilities',
    lat: 32.98489,
    lng: -96.75248,
  },

  // Construction areas are explicitly flagged, never represented as open buildings.
  {
    id: 'new-student-union',
    name: 'Student Union / Student Success Center Project',
    category: 'Construction',
    lat: 32.9875,
    lng: -96.74716,
    description: 'Construction footprint; check the university for its current status.',
  },
  {
    id: 'performance-hall-project',
    name: 'Performance Hall and Music Building Project',
    category: 'Construction',
    lat: 32.98313,
    lng: -96.74724,
    description: 'Construction footprint; check the university for its current status.',
    address: '777 Loop Road South, Richardson, TX 75080',
  },
];
