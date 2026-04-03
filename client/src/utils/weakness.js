export function analyzeWeakness(questions, answers) {
  const topicMap = {};

  questions.forEach((q) => {
    if (!topicMap[q.topic]) topicMap[q.topic] = { correct: 0, total: 0 };
    topicMap[q.topic].total += 1;
    if (answers[q.id] === q.answer) topicMap[q.topic].correct += 1;
  });

  return Object.entries(topicMap)
    .map(([topic, { correct, total }]) => ({
      topic,
      rate: Math.round((correct / total) * 100),
      total,
    }))
    .sort((a, b) => a.rate - b.rate);
}
