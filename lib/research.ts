/** Research basis, regulation and references shown in the app. Every reference
 * here was checked against the paper's bibliography or the publisher's record. */

export const PAPER = "Emotions in Software Engineering: A Systematic Mapping Study";

/** Team Health & Well-being studies per SDLC phase in the map (57 studies in total). */
export const TEAM_HEALTH_ROW = [
  { phase: "Requirements", studies: 4 },
  { phase: "Design / implementation", studies: 7 },
  { phase: "Testing", studies: 0 },
  { phase: "Maintenance", studies: 0 },
  { phase: "Cross-phase", studies: 5 },
];

export const AI_ACT = {
  citation:
    "Regulation (EU) 2024/1689 (Artificial Intelligence Act), Official Journal of the European Union, L series, 2024/1689",
  url: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
  art5_1_f:
    "the placing on the market, the putting into service for this specific purpose, or the use of AI systems to infer emotions of a natural person in the areas of workplace and education institutions, except where the use of the AI system is intended to be put in place or into the market for medical or safety reasons;",
  art3_39:
    "‘emotion recognition system’ means an AI system for the purpose of identifying or inferring emotions or intentions of natural persons on the basis of their biometric data;",
};

export const REFERENCES = [
  {
    key: "grassi23",
    text: "Grassi, D., Lanubile, F., Novielli, N., Serebrenik, A. Towards Supporting Emotion Awareness in Retrospective Meetings. ICSE-NIER 2023, pp. 101–105. doi:10.1109/ICSE-NIER58687.2023.00024",
  },
  {
    key: "kuutila18",
    text: "Kuutila, M., Mäntylä, M. V., Claes, M., Elovainio, M., Adams, B. Using experience sampling to link software repositories with emotions and work well-being. ESEM 2018, pp. 1–10.",
  },
  {
    key: "sweeney02",
    text: "Sweeney, L. k-Anonymity: A Model for Protecting Privacy. International Journal of Uncertainty, Fuzziness and Knowledge-Based Systems 10(5), 2002, pp. 557–570.",
  },
  {
    key: "denning79",
    text: "Denning, D. E., Denning, P. J., Schwartz, M. D. The Tracker: A Threat to Statistical Database Security. ACM Transactions on Database Systems 4(1), 1979, pp. 76–96.",
  },
  {
    key: "machanavajjhala07",
    text: "Machanavajjhala, A., Kifer, D., Gehrke, J., Venkitasubramaniam, M. ℓ-Diversity: Privacy Beyond k-Anonymity. ACM Transactions on Knowledge Discovery from Data 1(1), 2007. doi:10.1145/1217299.1217302",
  },
];
