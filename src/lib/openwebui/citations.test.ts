import { normalizeCitationSources } from "./citations";

test("normalizeCitationSources splits Open WebUI search citations into source results", () => {
  const sources = normalizeCitationSources({
    document: [
      "Lai Ching-te took office on May 20, 2024.",
      "The president is elected by direct vote.",
      "Lai was vice president before taking office.",
      "Taiwan's presidency is also called the Republic of China presidency.",
      "The 2024 election was held in January."
    ],
    metadata: [
      {
        source: "https://example.com/lai",
        title: "Lai Ching-te - Wikipedia"
      },
      {
        source: "https://example.com/president",
        title: "President of Taiwan"
      },
      {
        source: "https://example.com/profile",
        title: "Profile: Lai Ching-te"
      },
      {
        source: "https://example.com/office",
        title: "Office of the President"
      },
      {
        source: "https://example.com/election",
        title: "2024 Taiwanese presidential election"
      }
    ],
    source: {
      name: "search_web"
    }
  });

  expect(sources).toHaveLength(5);
  expect(sources.map((source) => source.index)).toEqual([1, 2, 3, 4, 5]);
  expect(sources.map((source) => source.name)).toEqual([
    "Lai Ching-te - Wikipedia",
    "President of Taiwan",
    "Profile: Lai Ching-te",
    "Office of the President",
    "2024 Taiwanese presidential election"
  ]);
  expect(sources[0]).toMatchObject({
    documents: ["Lai Ching-te took office on May 20, 2024."],
    metadata: [{ source: "https://example.com/lai", title: "Lai Ching-te - Wikipedia" }],
    url: "https://example.com/lai"
  });
});
