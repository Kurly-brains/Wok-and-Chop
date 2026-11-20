import { uberEatsUrl } from "../lib/ordering";
import SlidingDisclosure from "./sliding-disclosure";

const questions = [
  {
    question: "Can I order without an account?",
    answer: <>Yes. You can order pickup from Wok &amp; Chop as a guest.</>,
  },
  {
    question: "Do you offer home delivery?",
    answer: <>Yes. <a href={uberEatsUrl}>Order through Uber Eats</a> for home delivery and follow your order there.</>,
  },
  {
    question: "What about allergies?",
    answer: <>Please speak directly to the restaurant before ordering. Preparation notes cannot guarantee an allergen-free meal.</>,
  },
];

export default function OrderingQuestions() {
  return (
    <section className="menu-help" aria-labelledby="ordering-questions-title">
      <h2 id="ordering-questions-title">A few things before you order.</h2>
      {questions.map(({ question, answer }) => (
        <SlidingDisclosure
          key={question}
          className="menu-help-item"
          triggerClassName="menu-help-question"
          trigger={<>{question}<span className="menu-help-chevron" aria-hidden="true" /></>}
        >
          <p className="menu-help-answer">{answer}</p>
        </SlidingDisclosure>
      ))}
    </section>
  );
}
