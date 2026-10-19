import type { CreationCard, ImageView } from "../lib/types";

/** Builds a card for component tests. These are test data, not product content. */
export function card(index: number, overrides: Partial<CreationCard> = {}): CreationCard {
  const image: ImageView = {
    url: `/dev-fixtures/sample-${index}.svg`,
    srcSet: null,
    width: 800,
    height: index % 2 ? 1000 : 800,
  };
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Creation ${index}`,
    image,
    category: { slug: "cakes", name: "Cakes" },
    occasion: null,
    business: {
      slug: "cakes-by-maria",
      name: "Cakes by Maria",
      county: "Nairobi",
      city: "Westlands",
    },
    publishedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

export const page = (items: CreationCard[], pageNumber = 1, hasMore = false) => ({
  items,
  page: pageNumber,
  pageSize: 24,
  hasMore,
});
