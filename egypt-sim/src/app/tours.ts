/** Guided camera tours: sequences of fly-to waypoints with captions. */
export interface TourStop {
  lon: number;
  lat: number;
  distance: number;
  headingDeg: number;
  pitchDeg: number;
  caption: string;
  /** Seconds to linger after arriving. */
  dwell?: number;
}

export interface Tour {
  id: string;
  name: string;
  description: string;
  stops: TourStop[];
}

export const TOURS: Tour[] = [
  {
    id: 'nile',
    name: 'Fly the Nile',
    description: 'Aswan to the Delta: dams, temples and the green ribbon through the desert.',
    stops: [
      { lon: 32.88, lat: 23.6, distance: 160000, headingDeg: 10, pitchDeg: 40, caption: 'Lake Nasser — one of the largest reservoirs on Earth' },
      { lon: 32.877, lat: 23.975, distance: 9000, headingDeg: 200, pitchDeg: 28, caption: 'Aswan High Dam (1970)' },
      { lon: 32.884, lat: 24.026, distance: 1400, headingDeg: 330, pitchDeg: 22, caption: 'Philae — Temple of Isis on Agilkia Island' },
      { lon: 32.9, lat: 24.6, distance: 60000, headingDeg: 0, pitchDeg: 35, caption: 'Kom Ombo and Edfu along the Upper Egyptian Nile' },
      { lon: 32.655, lat: 25.712, distance: 3200, headingDeg: 120, pitchDeg: 24, caption: 'Luxor — Karnak and the Avenue of Sphinxes' },
      { lon: 32.606, lat: 25.737, distance: 1500, headingDeg: 290, pitchDeg: 16, caption: 'Deir el-Bahari — Temple of Hatshepsut' },
      { lon: 31.6, lat: 27.0, distance: 220000, headingDeg: 340, pitchDeg: 45, caption: 'Middle Egypt — the valley narrows between limestone plateaus' },
      { lon: 31.135, lat: 29.976, distance: 2600, headingDeg: 40, pitchDeg: 18, caption: 'Giza — the last Wonder of the Ancient World' },
      { lon: 31.1, lat: 30.75, distance: 240000, headingDeg: 0, pitchDeg: 60, caption: 'The Nile Delta fanning out to the Mediterranean' },
    ],
  },
  {
    id: 'cairo',
    name: 'Three Cairos',
    description: 'From the Pyramids through Islamic Cairo to the New Administrative Capital.',
    stops: [
      { lon: 31.132, lat: 29.977, distance: 1800, headingDeg: 30, pitchDeg: 14, caption: 'Pyramids of Giza' },
      { lon: 31.26, lat: 30.035, distance: 2600, headingDeg: 20, pitchDeg: 22, caption: 'Islamic Cairo — Citadel, Sultan Hassan and the medieval fabric' },
      { lon: 31.224, lat: 30.046, distance: 1500, headingDeg: 70, pitchDeg: 14, caption: 'Cairo Tower on Gezira Island' },
      { lon: 31.475, lat: 30.025, distance: 9000, headingDeg: 90, pitchDeg: 35, caption: 'New Cairo — planned superblocks' },
      { lon: 31.747, lat: 30.012, distance: 2600, headingDeg: 20, pitchDeg: 12, caption: 'New Administrative Capital — the Iconic Tower' },
    ],
  },
  {
    id: 'suez',
    name: 'Suez Canal transit',
    description: 'Port Said to Suez with the convoy, Lake Timsah and the Peace Bridge.',
    stops: [
      { lon: 32.3, lat: 31.25, distance: 6000, headingDeg: 170, pitchDeg: 25, caption: 'Port Said — Mediterranean entrance of the canal' },
      { lon: 32.315, lat: 30.826, distance: 3500, headingDeg: 330, pitchDeg: 14, caption: 'Suez Canal Bridge at El Qantara — Africa meets Asia' },
      { lon: 32.29, lat: 30.58, distance: 14000, headingDeg: 180, pitchDeg: 35, caption: 'Ismailia and Lake Timsah' },
      { lon: 32.38, lat: 30.33, distance: 40000, headingDeg: 170, pitchDeg: 45, caption: 'Great Bitter Lake, where convoys pass' },
      { lon: 32.55, lat: 29.96, distance: 9000, headingDeg: 180, pitchDeg: 30, caption: 'Suez and the Gulf of Suez' },
    ],
  },
  {
    id: 'coasts',
    name: 'Two seas',
    description: "Alexandria's Corniche, then the Red Sea resorts of Hurghada and Sharm.",
    stops: [
      { lon: 29.9, lat: 31.205, distance: 4500, headingDeg: 60, pitchDeg: 20, caption: 'Alexandria — Qaitbay and the Eastern Harbour' },
      { lon: 29.909, lat: 31.209, distance: 700, headingDeg: 200, pitchDeg: 18, caption: 'Bibliotheca Alexandrina' },
      { lon: 33.82, lat: 27.22, distance: 14000, headingDeg: 160, pitchDeg: 30, caption: 'Hurghada — resorts along the Red Sea reefs' },
      { lon: 34.33, lat: 27.91, distance: 12000, headingDeg: 30, pitchDeg: 30, caption: 'Sharm El Sheikh' },
      { lon: 33.97, lat: 28.53, distance: 15000, headingDeg: 200, pitchDeg: 18, caption: 'Mount Sinai and Saint Catherine' },
    ],
  },
];
