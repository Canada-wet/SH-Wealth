import {
  EMPTY_LIFESTYLE,
  type DJTrack,
  type Lifestyle,
} from "../../lib/lifestyle-schema";
export const testTrack = (
  id = "a",
  values: Partial<DJTrack> = {},
): DJTrack => ({
  id,
  title: `Track ${id}`,
  artist: "Synthetic artist",
  bpm: 124,
  key: "8A",
  genre: "House",
  energy: 5,
  duration: 300,
  cueNotes: "16 bars intro",
  rating: 4,
  cues: [],
  ...values,
});
export function lifestyleFixture(): Lifestyle {
  return {
    ...structuredClone(EMPTY_LIFESTYLE),
    tracks: [
      testTrack("a", {
        title: "Soft Arrival",
        artist: "Together Session",
        bpm: 122,
        key: "8A",
        genre: "Deep House",
        energy: 4,
        duration: 330,
      }),
      testTrack("b", {
        title: "Golden Hour",
        artist: "Together Session",
        bpm: 124,
        key: "9A",
        genre: "Deep House",
        energy: 5,
        duration: 360,
        rating: 5,
      }),
      testTrack("c", {
        title: "Afterglow",
        artist: "Together Session",
        bpm: 125,
        key: "9B",
        genre: "Disco",
        energy: 6,
        duration: 285,
      }),
      testTrack("d", {
        title: "Quiet Orbit",
        artist: "Together Session",
        bpm: null,
        key: "",
        genre: "Ambient",
        energy: null,
        duration: null,
        rating: null,
      }),
      testTrack("e", {
        title: "Night Window",
        artist: "Together Session",
        bpm: 126,
        key: "10A",
        genre: "House",
        energy: 7,
        duration: 310,
      }),
    ],
  };
}
