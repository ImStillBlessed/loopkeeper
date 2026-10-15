/**
 * Ready-made messages for testing the live chat from the CLI or the dashboard.
 * All fictional. Nigerian English and light Pidgin, like the rest of the synthetic group.
 */

export type PreparedKind = "issue" | "greeting" | "question" | "promise" | "fixed";

export const PREPARED: Record<PreparedKind, { senders: "teachers" | "staff" | "anyone"; texts: string[] }> = {
  issue: {
    senders: "teachers",
    texts: [
      "Good morning. Scores are not saving again for JSS1, the submit button just keeps loading",
      "Abeg the CBT timer no dey show for some students today",
      "Students in SS2 can't log in, it says invalid password but the password is correct",
      "The results page is showing the wrong position for some students",
      "Report cards are printing without the school logo since yesterday",
      "Please the app is very slow this morning, pages are taking forever to load",
      "When I try to upload questions from Word it says file not supported",
      "Some parents said they didn't get the SMS when results were released",
    ],
  },
  greeting: {
    senders: "anyone",
    texts: [
      "Good morning everyone 🌞",
      "Happy new week all. Success in all we do 🙏🏾",
      "God bless our day, Amen 🙏🏾",
      "Good afternoon sir/ma",
      "Thank you ma 🙏🏾",
      "*FORWARDED* Drink water and rest well this weekend. Share with your loved ones",
      "😂😂",
      "Happy birthday to all celebrants this month 🎂🎉",
    ],
  },
  question: {
    senders: "teachers",
    texts: [
      "Please how do I move a student to another class?",
      "Can we set two different CBT tests for the same class on one day?",
      "How do I reset the password for a teacher who left?",
      "Is it possible to download all the scores for my subject at once?",
    ],
  },
  promise: {
    senders: "staff",
    texts: [
      "Thanks for reporting. I'll look into it and get back to you by tomorrow",
      "We'll have a fix out by Friday",
      "I'll send the guide for this by end of day",
      "Noted ma, I'll call the school this afternoon to check",
    ],
  },
  fixed: {
    senders: "teachers",
    texts: [
      "It's working now, thank you 🙏🏾",
      "E don work now. Thank you so much",
      "Fine now, the scores saved. Thanks",
      "Thank you, the students can see it now",
    ],
  },
};

export const PREPARED_KINDS = Object.keys(PREPARED) as PreparedKind[];
