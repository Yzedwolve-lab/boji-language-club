export type TaskKey =
  "vocabulary" | "listening" | "reading" | "writing" | "speaking";
export const TASKS: TaskKey[] = [
  "vocabulary",
  "listening",
  "reading",
  "writing",
  "speaking",
];
export type Word = {
  lemma: string;
  sense: string;
  part: string;
  meaning: string;
  collocation: string;
  example: string;
};
export type SavedWord = Word & {
  id: string;
  sources: string[];
  savedAt: string;
  firstStudiedAt: string | null;
  nextReviewAt: string | null;
  reviewStep: number;
  status: "saved" | "learning" | "retrieved";
  mistakes: number;
};
export type Recording = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
};
export type LearningProgress = {
  vocabulary: number | null;
  listening: number | null;
  reading: number | null;
  writing: number | null;
  speaking: number | null;
  attempts: Array<{
    id: string;
    task: string;
    input: string;
    score: number | null;
    createdAt: string;
    feedback: string;
    kind?: string;
  }>;
  answersRevealed: boolean;
  drafts?: Record<string, string>;
  checked?: Record<string, boolean>;
  words?: SavedWord[];
  vocabularySet?: Word[];
  vocabularyReviewIds?: string[];
  recordings?: Recording[];
  playbackCount?: number;
  listeningMode?: "audio" | "text";
  pronunciation?: null;
  fluency?: null;
};
export function emptyLearningProgress(): LearningProgress {
  return {
    vocabulary: null,
    listening: null,
    reading: null,
    writing: null,
    speaking: null,
    attempts: [],
    answersRevealed: false,
    drafts: {},
    checked: {},
    words: [],
    recordings: [],
    playbackCount: 0,
    listeningMode: "audio",
    pronunciation: null,
    fluency: null,
  };
}
export const WORDS: Word[] = [
  {
    lemma: "consistent",
    sense: "regular",
    part: "adj.",
    meaning: "持续稳定的",
    collocation: "consistent effort",
    example: "A small, consistent effort is easier to maintain.",
  },
  {
    lemma: "routine",
    sense: "habit",
    part: "n.",
    meaning: "日常惯例",
    collocation: "a morning routine",
    example: "My morning routine includes a short walk.",
  },
  {
    lemma: "organize",
    sense: "arrange",
    part: "v.",
    meaning: "安排；组织",
    collocation: "organize your week",
    example: "I organize my week on Sunday evening.",
  },
  {
    lemma: "flexible",
    sense: "adaptable",
    part: "adj.",
    meaning: "灵活的",
    collocation: "a flexible plan",
    example: "A flexible plan leaves room for rest.",
  },
  {
    lemma: "portion",
    sense: "serving",
    part: "n.",
    meaning: "一份食物",
    collocation: "a small portion",
    example: "The recipe makes one portion of soup.",
  },
  {
    lemma: "prepare",
    sense: "make-ready",
    part: "v.",
    meaning: "准备",
    collocation: "prepare a meal",
    example: "We prepare our lunch before work.",
  },
  {
    lemma: "gradual",
    sense: "slow-change",
    part: "adj.",
    meaning: "逐步的",
    collocation: "gradual progress",
    example: "Gradual progress can be difficult to notice.",
  },
  {
    lemma: "balance",
    sense: "fair-mix",
    part: "n.",
    meaning: "平衡",
    collocation: "a healthy balance",
    example: "I look for a balance between work and rest.",
  },
  {
    lemma: "practise",
    sense: "rehearse",
    part: "v.",
    meaning: "练习",
    collocation: "practise speaking",
    example: "I practise speaking with a friend.",
  },
];
export type Question = {
  id: string;
  prompt: string;
  answers: string[];
  options?: string[];
  hint: string;
  explanation: string;
};
export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  words: Word[];
  vocabularyQuestions: Question[];
  vocabularyRetry: Question[];
  transcript: string;
  listeningQuestions: Question[];
  listeningRetry: Question[];
  reading: string;
  readingQuestions: Question[];
  readingRetry: Question[];
  writingPrompt: string;
  writingModel: string;
  speakingPrompt: string;
  speakingExample: string;
};
const question = (
  id: string,
  prompt: string,
  answers: string[],
  hint: string,
  explanation: string,
  options?: string[],
): Question => ({ id, prompt, answers, hint, explanation, options });
const LESSONS: Lesson[] = [
  {
    id: "original-habits-v1",
    title: "Small steps. Real progress.",
    subtitle: "从一个小习惯，练习更自然的表达。",
    words: WORDS.slice(0, 3),
    vocabularyQuestions: [
      question(
        "habit-v1",
        "A regular, steady effort is a ______ effort.",
        ["consistent"],
        "形容词：稳定、持续；以 c 开头。",
        "consistent 描述持续而稳定的行为。",
      ),
      question(
        "habit-v2",
        "A habit you follow every morning is a morning ______.",
        ["routine"],
        "名词：日常惯例；以 r 开头。",
        "morning routine 是“晨间惯例”的常见搭配。",
      ),
      question(
        "habit-v3",
        "To put plans in order: ______ your week.",
        ["organize", "organise"],
        "动词：安排；英美拼写均可。",
        "organize / organise 是可接受的美式 / 英式拼写。",
      ),
    ],
    vocabularyRetry: [
      question(
        "habit-vr1",
        "She studies regularly. Her effort is ______.",
        ["consistent"],
        "不是突然很多，而是稳定持续。",
        "consistent effort = 持续的努力。",
      ),
      question(
        "habit-vr2",
        "After breakfast, I walk the same route. It is part of my daily ______.",
        ["routine"],
        "daily 后面用表示“惯例”的名词。",
        "daily routine = 日常惯例。",
      ),
      question(
        "habit-vr3",
        "Please ______ the tasks into a clear schedule.",
        ["organize", "organise"],
        "把任务安排到日程中。",
        "organize tasks = 安排任务。",
      ),
    ],
    transcript:
      "Hi, I am Maya. I used to make ambitious plans and then give up. Now I practise English for ten minutes after breakfast. On busy days, I only review three words. Every Sunday, I look back at my week and choose one small change. A flexible routine helps me keep going.",
    listeningQuestions: [
      question(
        "habit-l1",
        "When does Maya usually practise English?",
        ["After breakfast"],
        "留意时间表达 after。",
        "Maya 说：ten minutes after breakfast。",
        ["Before breakfast", "After breakfast", "At midnight"],
      ),
      question(
        "habit-l2",
        "What does Maya do on busy days?",
        ["Review three words"],
        "留意 busy days 之后的动作。",
        "忙碌时，她只复习三个词。",
        ["Study for an hour", "Skip every activity", "Review three words"],
      ),
    ],
    listeningRetry: [
      question(
        "habit-lr1",
        "How long is her usual practice?",
        ["Ten minutes"],
        "留意 minutes 前面的数量。",
        "通常练习 ten minutes。",
        ["Ten minutes", "Thirty minutes", "One hour"],
      ),
      question(
        "habit-lr2",
        "What helps her continue?",
        ["A flexible routine"],
        "留意最后一句的主语。",
        "A flexible routine helps me keep going。",
        ["A fixed exam date", "A flexible routine", "A larger textbook"],
      ),
    ],
    reading:
      "At the start of the month, Leo planned to learn twenty new words every day. After three days, he had forgotten many of them. He changed his approach. Now he learns three useful words and revisits older ones before adding more. He also uses each word in a sentence about his own life. His daily list is shorter, but he can remember more when he needs to speak. For Leo, a consistent routine matters more than a long list.",
    readingQuestions: [
      question(
        "habit-r1",
        "What is the main idea?",
        ["Small, repeated practice can be useful"],
        "比较最初计划和修改后的效果。",
        "短清单配合复习让 Leo 更容易回忆。",
        [
          "Long lists always work best",
          "Small, repeated practice can be useful",
          "Speaking is unnecessary",
        ],
      ),
      question(
        "habit-r2",
        "What does Leo do before adding more words?",
        ["Revisits older words"],
        "找到 before adding more。",
        "原文明确说 revisits older ones。",
        ["Takes an exam", "Revisits older words", "Stops practising"],
      ),
      question(
        "habit-r3",
        "Why are his example sentences personal?",
        ["They connect words with his life"],
        "根据 about his own life 理解用途。",
        "个人例句把词与实际生活联系起来。",
        [
          "They connect words with his life",
          "They make his list longer",
          "They replace all review",
        ],
      ),
    ],
    readingRetry: [
      question(
        "habit-rr1",
        "How many new words does Leo learn now?",
        ["Three"],
        "定位 changed his approach 之后的句子。",
        "Now he learns three useful words。",
        ["Three", "Twenty", "Thirty"],
      ),
      question(
        "habit-rr2",
        "What was a problem with his first plan?",
        ["He forgot many words"],
        "查看第二句话。",
        "After three days, he had forgotten many of them。",
        [
          "He had no notebook",
          "He forgot many words",
          "He could not find words",
        ],
      ),
      question(
        "habit-rr3",
        "“Revisits older ones” means:",
        ["Reviews words learned earlier"],
        "ones 指之前的 words。",
        "revisit 在此表示重新复习。",
        [
          "Visits old friends",
          "Reviews words learned earlier",
          "Writes a longer list",
        ],
      ),
    ],
    writingPrompt:
      "Describe one small habit you want to build. Explain when you will practise it, why it matters, and what you will do on a busy day.",
    writingModel:
      "I want to build a regular English practice habit. After breakfast, I will spend ten minutes reading a short article. This matters to me because I want to express my ideas more clearly. On a busy day, I will review three useful words instead. A small, flexible plan will help me keep going.",
    speakingPrompt:
      "Tell a friend about a small habit that helps you. What is it, when do you do it, and why is it useful?",
    speakingExample:
      "One habit that helps me is preparing my bag in the evening. I do it after dinner. It makes my mornings calmer because I do not have to look for things before leaving home.",
  },
  {
    id: "original-lunch-v1",
    title: "A little preparation goes a long way.",
    subtitle: "从一顿午餐，聊聊计划与选择。",
    words: WORDS.slice(3, 6),
    vocabularyQuestions: [
      question(
        "lunch-v1",
        "A plan that can change is ______.",
        ["flexible", "adaptable"],
        "形容词：灵活的。",
        "flexible / adaptable 均描述可调整的计划。",
      ),
      question(
        "lunch-v2",
        "One serving of soup is one ______.",
        ["portion", "serving"],
        "名词：一份食物。",
        "portion 与 serving 在这里均可。",
      ),
      question(
        "lunch-v3",
        "To make lunch ready is to ______ lunch.",
        ["prepare", "make"],
        "动词：准备。",
        "prepare lunch / make lunch 都是自然表达。",
      ),
    ],
    vocabularyRetry: [
      question(
        "lunch-vr1",
        "We can move the meeting. Our schedule is ______.",
        ["flexible", "adaptable"],
        "日程可以调整。",
        "flexible schedule = 灵活的日程。",
      ),
      question(
        "lunch-vr2",
        "The recipe makes a single ______ of rice.",
        ["portion", "serving"],
        "表示一人份。",
        "a portion / serving of rice。",
      ),
      question(
        "lunch-vr3",
        "I ______ my breakfast before leaving home.",
        ["prepare", "make"],
        "在离家前准备早餐。",
        "prepare / make 表示准备。",
      ),
    ],
    transcript:
      "This Saturday, our cooking group will meet at eleven in the community kitchen. We will prepare vegetable soup and sandwiches. Please bring a container so you can take a portion home. You do not need to bring any ingredients. If you have a food allergy, tell the organiser before Friday.",
    listeningQuestions: [
      question(
        "lunch-l1",
        "What time will the group meet?",
        ["Eleven"],
        "听第一句时间。",
        "The group meets at eleven。",
        ["Nine", "Eleven", "One"],
      ),
      question(
        "lunch-l2",
        "What should participants bring?",
        ["A container"],
        "留意 Please bring。",
        "需要容器来带走一份食物。",
        ["Ingredients", "A container", "A recipe book"],
      ),
    ],
    listeningRetry: [
      question(
        "lunch-lr1",
        "Where is the meeting?",
        ["The community kitchen"],
        "留意地点。",
        "地点是 community kitchen。",
        ["The park", "The community kitchen", "A restaurant"],
      ),
      question(
        "lunch-lr2",
        "When should allergies be reported?",
        ["Before Friday"],
        "听最后一句。",
        "before Friday 是明确截止时间。",
        ["After Saturday", "On Sunday", "Before Friday"],
      ),
    ],
    reading:
      "Nina often bought lunch at the last minute. She wanted a calmer lunch break, so she began preparing a simple meal the evening before. Her plan is flexible: some days she packs leftovers, and other days she brings bread and a filling. She does not follow the same menu every week. Preparing lunch gives her more time to eat slowly and talk with colleagues. She says the most useful change is having fewer decisions to make during a busy working day.",
    readingQuestions: [
      question(
        "lunch-r1",
        "Why did Nina start preparing lunch?",
        ["She wanted a calmer lunch break"],
        "定位 wanted。",
        "她想要 calmer lunch break。",
        [
          "She wanted a calmer lunch break",
          "Her office closed",
          "Her friend required it",
        ],
      ),
      question(
        "lunch-r2",
        "When does she prepare her meal?",
        ["The evening before"],
        "阅读第一处 preparing。",
        "the evening before 表示前一天晚上。",
        ["At the last minute", "The evening before", "Every Sunday only"],
      ),
      question(
        "lunch-r3",
        "What describes her plan best?",
        ["It allows different meals"],
        "结合 flexible 和菜单变化。",
        "她根据当天情况带不同的午餐。",
        [
          "It requires one fixed menu",
          "It allows different meals",
          "It avoids all leftovers",
        ],
      ),
    ],
    readingRetry: [
      question(
        "lunch-rr1",
        "What does Nina sometimes pack?",
        ["Leftovers"],
        "定位 some days。",
        "some days she packs leftovers。",
        ["Only soup", "Leftovers", "No food"],
      ),
      question(
        "lunch-rr2",
        "What is her most useful change?",
        ["Fewer decisions during work"],
        "查看最后一句。",
        "忙碌工作日需要做的决定减少了。",
        [
          "A larger kitchen",
          "Fewer decisions during work",
          "A shorter work week",
        ],
      ),
      question(
        "lunch-rr3",
        "“Flexible” is closest in meaning to:",
        ["Able to change"],
        "她没有固定每周菜单。",
        "flexible = 可调整的。",
        ["Expensive", "Able to change", "Difficult"],
      ),
    ],
    writingPrompt:
      "Describe how you would prepare for a busy day. Include one practical action, a reason, and an alternative if your plan changes.",
    writingModel:
      "Before a busy day, I prepare a simple lunch in the evening. This saves time when I need a break at work. I usually pack leftovers in a container, but my plan is flexible. If I have no leftovers, I make a sandwich instead. Preparing one thing early helps me feel less rushed.",
    speakingPrompt:
      "Describe a meal you enjoy preparing. What do you need, how do you prepare it, and why do you like it?",
    speakingExample:
      "I enjoy preparing vegetable soup. I need carrots, potatoes, water and a little seasoning. I cut the vegetables and cook them until they are soft. I like this meal because I can prepare extra portions for another day.",
  },
  {
    id: "original-rest-v1",
    title: "Make room for a reset.",
    subtitle: "学会描述休息，也学会保持节奏。",
    words: WORDS.slice(6, 9),
    vocabularyQuestions: [
      question(
        "rest-v1",
        "Slow change over time is ______ change.",
        ["gradual"],
        "形容词：逐步的。",
        "gradual 描述逐步发生的变化。",
      ),
      question(
        "rest-v2",
        "A fair mix of work and rest is a good ______.",
        ["balance"],
        "名词：平衡。",
        "balance between work and rest。",
      ),
      question(
        "rest-v3",
        "To improve by doing something repeatedly is to ______.",
        ["practise", "practice"],
        "动词：练习；英美拼写均可。",
        "动词 practise（英式）/ practice（美式）均可。",
      ),
    ],
    vocabularyRetry: [
      question(
        "rest-vr1",
        "The change happened slowly. It was ______.",
        ["gradual"],
        "slow change 的同义表达。",
        "gradual change = 逐步的变化。",
      ),
      question(
        "rest-vr2",
        "I want a ______ between study and free time.",
        ["balance"],
        "固定搭配 a ... between。",
        "a balance between 两者之间的平衡。",
      ),
      question(
        "rest-vr3",
        "I ______ English with a friend every week.",
        ["practise", "practice"],
        "动词：反复练习。",
        "practise / practice English。",
      ),
    ],
    transcript:
      "Welcome to our afternoon walking group. Today we will follow the river path for twenty minutes. The route is flat, and we will walk at a relaxed pace. We will return to the library entrance at three thirty. If it rains before we start, we will meet inside the library for a conversation instead.",
    listeningQuestions: [
      question(
        "rest-l1",
        "How long is the walk?",
        ["Twenty minutes"],
        "听 minutes 前的数量。",
        "for twenty minutes。",
        ["Ten minutes", "Twenty minutes", "Forty minutes"],
      ),
      question(
        "rest-l2",
        "What happens if it rains before the start?",
        ["An indoor conversation"],
        "听最后一句。",
        "改为在图书馆内聊天。",
        ["A longer walk", "An indoor conversation", "A running race"],
      ),
    ],
    listeningRetry: [
      question(
        "rest-lr1",
        "Where will the group return?",
        ["The library entrance"],
        "留意 return to。",
        "返回 library entrance。",
        ["The bus stop", "The library entrance", "The cafe"],
      ),
      question(
        "rest-lr2",
        "What pace will the group use?",
        ["A relaxed pace"],
        "留意 pace 前的形容词。",
        "a relaxed pace。",
        ["A racing pace", "A relaxed pace", "No fixed route"],
      ),
    ],
    reading:
      "Owen used to study until he felt exhausted. He noticed that his attention often faded long before he stopped. Now he pauses after a focused study session. During the break, he leaves his desk and looks outside. He does not use a timer to judge how much he has learned. Instead, he checks whether he can explain one idea in his own words. This gradual change has helped him find a better balance between effort and rest.",
    readingQuestions: [
      question(
        "rest-r1",
        "What did Owen notice about his attention?",
        ["It faded before he stopped"],
        "阅读第二句。",
        "his attention often faded long before he stopped。",
        [
          "It never changed",
          "It faded before he stopped",
          "It improved when exhausted",
        ],
      ),
      question(
        "rest-r2",
        "How does he check his learning?",
        ["Explains an idea in his own words"],
        "定位 Instead。",
        "通过用自己的话解释一个想法。",
        [
          "Counts minutes only",
          "Explains an idea in his own words",
          "Counts pages only",
        ],
      ),
      question(
        "rest-r3",
        "What is a suitable title?",
        ["Finding a balance in study"],
        "文章围绕学习与休息之间的变化。",
        "主题为 study 与 rest 的平衡。",
        [
          "Finding a balance in study",
          "Buying a better timer",
          "Studying all night",
        ],
      ),
    ],
    readingRetry: [
      question(
        "rest-rr1",
        "What does Owen do during a break?",
        ["Leaves his desk"],
        "定位 During the break。",
        "he leaves his desk。",
        ["Starts another lesson", "Leaves his desk", "Checks an exam result"],
      ),
      question(
        "rest-rr2",
        "What does he avoid using as proof of learning?",
        ["A timer"],
        "定位 does not use。",
        "计时不能证明学到了多少。",
        ["His own explanation", "A timer", "A clear example"],
      ),
      question(
        "rest-rr3",
        "His change was:",
        ["Gradual"],
        "看最后一句。",
        "This gradual change。",
        ["Sudden and complete", "Gradual", "Unrelated to rest"],
      ),
    ],
    writingPrompt:
      "Describe a way to take a useful study break. Explain what you would do, why you chose it, and how you would return to your task.",
    writingModel:
      "After a focused study session, I would take a short break away from my desk. I would look outside or walk around the room. I choose this break because it helps me pause without starting another demanding activity. When I return, I would explain the last idea in my own words before continuing.",
    speakingPrompt:
      "Tell a friend about a relaxing activity. What do you do, when do you do it, and how does it fit into your day?",
    speakingExample:
      "I like taking a short walk after work. I usually choose a quiet street near my home. I leave my phone in my pocket and notice the trees and buildings around me. It gives me a calm moment before I start my evening tasks.",
  },
];
export function getLesson(dayIndex: number): Lesson {
  return (
    LESSONS[(Math.max(1, Math.floor(dayIndex)) - 1) % LESSONS.length] ??
    LESSONS[0]
  );
}
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .trim()
    .replace(/[.,!?;:"“”'‘’]+$/g, "")
    .replace(/\s+/g, " ");
}
export function evaluateObjective(
  questions: Question[],
  drafts: Record<string, string>,
): { score: number; wrongIds: string[] } {
  const wrongIds = questions
    .filter(
      (q) =>
        !q.answers.some(
          (answer) =>
            normalizeAnswer(answer) === normalizeAnswer(drafts[q.id] ?? ""),
        ),
    )
    .map((q) => q.id);
  return {
    score: questions.length
      ? Math.round(
          ((questions.length - wrongIds.length) / questions.length) * 100,
        )
      : 0,
    wrongIds,
  };
}
export function learningAverage(value: LearningProgress): number | null {
  const scores = TASKS.map((key) => value[key]);
  return scores.every(
    (score): score is number =>
      typeof score === "number" &&
      Number.isFinite(score) &&
      score >= 0 &&
      score <= 100,
  )
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / 5)
    : null;
}
export function learningPassed(value: LearningProgress): boolean {
  const average = learningAverage(value);
  return (
    average !== null &&
    average >= 70 &&
    TASKS.every((key) => (value[key] ?? -1) >= 60)
  );
}
export function wordId(word: Pick<Word, "lemma" | "sense">): string {
  const lemma = normalizeAnswer(word.lemma)
    .replace(/^organise$/, "organize")
    .replace(/^practice$/, "practise");
  const known = WORDS.find(
    (entry) =>
      entry.lemma === lemma &&
      (entry.sense === word.sense ||
        normalizeAnswer(entry.meaning) === normalizeAnswer(word.sense)),
  );
  return `${lemma}:${known?.sense ?? normalizeAnswer(word.sense)}`;
}
export function addSavedWord(
  words: SavedWord[],
  word: Word,
  source: string,
  now: string,
): SavedWord[] {
  const id = wordId(word);
  const existing = words.find((entry) => entry.id === id);
  if (existing)
    return words.map((entry) =>
      entry.id === id
        ? { ...entry, sources: Array.from(new Set([...entry.sources, source])) }
        : entry,
    );
  return [
    ...words,
    {
      ...word,
      id,
      sources: [source],
      savedAt: now,
      firstStudiedAt: null,
      nextReviewAt: null,
      reviewStep: 0,
      status: "saved",
      mistakes: 0,
    },
  ];
}
export function markWordReviewed(
  word: SavedWord,
  correct: boolean,
  now: string,
): SavedWord {
  const intervals = [1, 3, 7, 14, 30];
  const step =
    correct && word.firstStudiedAt
      ? Math.min(word.reviewStep + 1, intervals.length - 1)
      : 0;
  return {
    ...word,
    firstStudiedAt: word.firstStudiedAt ?? now,
    nextReviewAt: new Date(
      new Date(now).getTime() + intervals[step] * 86400000,
    ).toISOString(),
    reviewStep: step,
    status: correct ? "retrieved" : "learning",
    mistakes: word.mistakes + (correct ? 0 : 1),
  };
}
export function planVocabulary(
  saved: SavedWord[],
  candidates: Word[],
  quota: number,
  now: string,
): { review: SavedWord[]; fresh: Word[]; deferred: number } {
  const due = saved
    .filter((word) => word.nextReviewAt && word.nextReviewAt <= now)
    .sort(
      (a, b) =>
        b.mistakes - a.mistakes ||
        (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""),
    );
  const review = due.slice(0, Math.max(0, quota));
  const pool = [
    ...saved.filter((word) => !word.firstStudiedAt),
    ...candidates,
  ].filter(
    (word, index, all) =>
      all.findIndex((other) => wordId(word) === wordId(other)) === index &&
      !saved.some(
        (existing) => existing.id === wordId(word) && existing.firstStudiedAt,
      ),
  );
  const fresh = pool.slice(0, Math.max(0, quota - review.length));
  return {
    review,
    fresh,
    deferred:
      Math.max(0, due.length - review.length) +
      Math.max(0, pool.length - fresh.length),
  };
}
export function countWords(text: string): number {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

const AUDIO_DB = "boji-private-demo-audio";
function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("浏览器不支持本地音频存储。"));
      return;
    }
    const request = indexedDB.open(AUDIO_DB, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("recordings"))
        request.result.createObjectStore("recordings");
      if (!request.result.objectStoreNames.contains("metadata"))
        request.result.createObjectStore("metadata");
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("其他旧页面阻止了音频存储更新，请关闭后重试。"));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
/** Capture before recording or uploading. Clearing data atomically advances this
 * generation, so an older recording cannot recreate audio after deletion. */
export async function getAudioGeneration(): Promise<number> {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("metadata")
      .objectStore("metadata")
      .get("generation");
    request.onsuccess = () => {
      db.close();
      resolve(Number(request.result ?? 0));
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
export class AudioDataDeletedError extends Error {
  constructor() {
    super("资料已经删除，这段较早开始的录音不会重新保存。");
    this.name = "AudioDataDeletedError";
  }
}
export async function saveRecordingBlob(
  id: string,
  blob: Blob,
  expectedGeneration: number,
): Promise<void> {
  if (
    !id ||
    !(blob instanceof Blob) ||
    !blob.size ||
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 0
  )
    throw new Error("Invalid local audio save request.");
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["recordings", "metadata"], "readwrite");
    let deleted = false;
    const generation = tx.objectStore("metadata").get("generation");
    generation.onsuccess = () => {
      if (Number(generation.result ?? 0) !== expectedGeneration) {
        deleted = true;
        tx.abort();
        return;
      }
      tx.objectStore("recordings").put(blob, id);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        deleted
          ? new AudioDataDeletedError()
          : (tx.error ?? new Error("本地音频保存已中止。")),
      );
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function readRecordingBlob(id: string): Promise<Blob | null> {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("recordings")
      .objectStore("recordings")
      .get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
export async function clearLearningAudio(): Promise<void> {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["recordings", "metadata"], "readwrite");
    tx.objectStore("recordings").clear();
    const generation = tx.objectStore("metadata").get("generation");
    generation.onsuccess = () =>
      tx
        .objectStore("metadata")
        .put(Number(generation.result ?? 0) + 1, "generation");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("本地音频清理已中止。"));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
