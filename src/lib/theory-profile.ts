export const theoryDomainDefinitions = [
  {
    value: "identity",
    label: "個人語彙",
    shortLabel: "身份",
    description: "你希望作品一聽就被辨認出的核心氣質。",
    prompts: [
      "別人聽完你的歌，最希望記住哪一種情緒或信念？",
      "哪些聲音或寫法一出現，就不像你的作品？",
      "如果只能保留三個創作特徵，你會留下什麼？"
    ]
  },
  {
    value: "harmony",
    label: "和聲 / 和弦",
    shortLabel: "和聲",
    description: "和弦如何服務情緒、歌詞與張力。",
    prompts: [
      "盼望、安靜、掙扎與宣告，各自偏好哪些和弦顏色？",
      "你喜歡什麼時候加入借用和弦、掛留音或轉調？",
      "哪些和弦進行對你來說太俗套或太炫技？"
    ]
  },
  {
    value: "melody",
    label: "旋律",
    shortLabel: "旋律",
    description: "音域、動機、重複與高潮的個人判斷。",
    prompts: [
      "主歌與副歌的音域和旋律密度應該差多少？",
      "你喜歡旋律先貼近說話，還是先建立明顯 hook？",
      "最高音應該放在什麼字、什麼情緒與什麼段落？"
    ]
  },
  {
    value: "rhythm",
    label: "節奏 / Groove",
    shortLabel: "節奏",
    description: "拍點鬆緊、切分、速度與律動偏好。",
    prompts: [
      "你喜歡拍點正、稍微靠後，還是帶明顯切分？",
      "主歌、副歌與 Bridge 的鼓組應如何推進？",
      "哪些速度與節奏型最能承載你的歌詞？"
    ]
  },
  {
    value: "structure",
    label: "曲式 / 能量",
    shortLabel: "曲式",
    description: "段落長度、進場時機與整首能量曲線。",
    prompts: [
      "你偏好多快進入副歌，Intro 最長可以多長？",
      "第二次副歌要靠什麼變化，而不是只變大聲？",
      "Bridge 的任務是轉折、禱告、宣告，還是留白？"
    ]
  },
  {
    value: "lyrics",
    label: "歌詞 / 語韻",
    shortLabel: "歌詞",
    description: "詞彙、敘事、信仰表達與咬字節奏。",
    prompts: [
      "你偏好生活語言、詩意隱喻，還是直接宣告？",
      "哪些詞你常用、哪些詞你不希望再出現？",
      "歌詞押韻、字數與旋律自然度，哪一項優先？"
    ]
  },
  {
    value: "arrangement",
    label: "編曲",
    shortLabel: "編曲",
    description: "樂器分工、密度與段落推進方式。",
    prompts: [
      "哪些樂器是你的核心，哪些只在特定段落出現？",
      "主歌要留下哪些空間，副歌要增加哪些層次？",
      "什麼情況應該拿掉樂器，而不是再加一軌？"
    ]
  },
  {
    value: "vocal",
    label: "人聲 / 和聲",
    shortLabel: "人聲",
    description: "主唱表情、音域、疊唱與和聲配置。",
    prompts: [
      "你希望主唱靠近耳邊，還是有舞台與空間感？",
      "和聲應該在哪些字出現，最多疊幾層？",
      "哪些不完美需要保留，哪些一定要重錄？"
    ]
  },
  {
    value: "sound",
    label: "音色 / 年代",
    shortLabel: "音色",
    description: "樂器質地、年代、空間與聲音選擇。",
    prompts: [
      "你偏好的鋼琴、吉他、鼓與合成器質地是什麼？",
      "哪些年代的聲音可以借用，哪些會顯得過時？",
      "一首歌的音色數量與主次應如何控制？"
    ]
  },
  {
    value: "mixing",
    label: "混音 / 空間",
    shortLabel: "混音",
    description: "音量層級、頻率、動態與空間效果。",
    prompts: [
      "主唱、鼓、Bass 與主要樂器的前後順序是什麼？",
      "低頻、中頻與高頻各自希望帶來什麼感覺？",
      "Reverb、Delay 與壓縮到什麼程度就算過量？"
    ]
  },
  {
    value: "mastering",
    label: "母帶 / 交付",
    shortLabel: "母帶",
    description: "響度、動態、音質安全與版本交付標準。",
    prompts: [
      "你更重視響度、動態、溫暖，還是清晰度？",
      "哪些 clipping、低頻或高頻狀況一定不能接受？",
      "串流、影片與現場使用是否需要不同母帶版本？"
    ]
  }
] as const;

export type TheoryDomainValue = (typeof theoryDomainDefinitions)[number]["value"];

export type TheoryRuleReadinessInput = {
  statement: string;
  scope?: string | null;
  examples: string[];
  avoid: string[];
  tags: string[];
  priority: number;
  isActive: boolean;
};

export function evaluateTheoryRuleReadiness(rule: TheoryRuleReadinessInput) {
  let completion = 0;
  const missingFields: string[] = [];

  if (rule.statement.trim().length >= 20) completion += 35;
  else missingFields.push("具體原則");

  if (rule.scope?.trim()) completion += 15;
  else missingFields.push("適用範圍");

  if (rule.examples.length > 0) completion += 20;
  else missingFields.push("正面例子");

  if (rule.avoid.length > 0) completion += 15;
  else missingFields.push("避免事項");

  if (rule.tags.length > 0) completion += 10;
  else missingFields.push("標籤");

  if (rule.priority >= 1 && rule.priority <= 3) completion += 5;
  else missingFields.push("明確優先級");

  return {
    completion,
    aiReady: rule.isActive && completion >= 70,
    missingFields
  };
}

type TheoryProfileRule = TheoryRuleReadinessInput & {
  ruleType: string;
};

export function buildTheoryProfileSummary(rules: TheoryProfileRule[]) {
  const domains = theoryDomainDefinitions.map((domain) => {
    const domainRules = rules.filter((rule) => rule.ruleType === domain.value);
    const activeRules = domainRules.filter((rule) => rule.isActive);
    const readiness = domainRules.map(evaluateTheoryRuleReadiness);
    const completion = readiness.length ? Math.max(...readiness.map((item) => item.completion)) : 0;
    const readyRules = readiness.filter((item) => item.aiReady).length;
    return {
      ...domain,
      completion,
      ruleCount: domainRules.length,
      activeRuleCount: activeRules.length,
      readyRuleCount: readyRules,
      status: readyRules > 0 ? "ready" : domainRules.length > 0 ? "draft" : "empty"
    };
  });
  const coveredDomains = domains.filter((domain) => domain.readyRuleCount > 0).length;
  const startedDomains = domains.filter((domain) => domain.ruleCount > 0).length;
  const aiReadyRules = rules.filter((rule) => evaluateTheoryRuleReadiness(rule).aiReady).length;
  const overallCompletion = Math.round(domains.reduce((total, domain) => total + domain.completion, 0) / domains.length);

  return {
    domains,
    totalDomains: domains.length,
    coveredDomains,
    startedDomains,
    aiReadyRules,
    overallCompletion
  };
}
