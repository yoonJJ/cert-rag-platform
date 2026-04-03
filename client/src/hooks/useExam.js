import { useState, useEffect, useCallback } from 'react';

export function useExam(questions, timeLimitMinutes) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(timeLimitMinutes * 60);
  const [submitted, setSubmitted] = useState(false);

  const submit = useCallback(() => setSubmitted(true), []);

  useEffect(() => {
    setCurrent(0);
    setAnswers({});
    setTimeLeft(timeLimitMinutes * 60);
    setSubmitted(false);
  }, [questions, timeLimitMinutes]);

  useEffect(() => {
    if (submitted) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          submit();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submitted, submit]);

  const select = (questionId, optionIndex) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  };

  const score = () => {
    const correct = questions.filter((q) => answers[q.id] === q.answer).length;
    return questions.length ? Math.round((correct / questions.length) * 100) : 0;
  };

  const formatTime = () => {
    const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const s = (timeLeft % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return { current, setCurrent, answers, select, submitted, submit, score, formatTime, timeLeft };
}
