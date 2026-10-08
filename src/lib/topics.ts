export const TOPIC_CATEGORIES: { category: string; topics: string[] }[] = [
  {
    category: "Society & Culture",
    topics: [
      "Social media is doing more harm than good to society",
      "Reality TV shapes public taste for the worse",
      "Arranged marriages are becoming obsolete",
      "Influencer culture is damaging youth aspirations",
    ],
  },
  {
    category: "Technology",
    topics: [
      "Artificial Intelligence will create more jobs than it destroys",
      "Should governments regulate AI development more strictly?",
      "Remote work is more productive than office work",
      "Cryptocurrency is the future of global finance",
    ],
  },
  {
    category: "Education",
    topics: [
      "Standardized testing should be abolished",
      "Online education is as effective as classroom learning",
      "Should coding be a mandatory subject in schools?",
      "Grades do more harm than good to student learning",
    ],
  },
  {
    category: "Economy & Business",
    topics: [
      "Universal Basic Income should be implemented nationwide",
      "The 4-day work week should become the global standard",
      "Startups create more value for society than big corporations",
      "Globalization has widened the gap between rich and poor",
    ],
  },
  {
    category: "Environment",
    topics: [
      "Individual actions matter more than government policy in fighting climate change",
      "Nuclear energy is the best solution to the energy crisis",
      "Fast fashion should be banned",
      "Electric vehicles are not as eco-friendly as they claim to be",
    ],
  },
];

export const ALL_TOPICS: string[] = TOPIC_CATEGORIES.flatMap((c) => c.topics);

export function isKnownTopic(topic: string): boolean {
  return ALL_TOPICS.includes(topic);
}
