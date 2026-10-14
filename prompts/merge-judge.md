You decide whether support issues describe the same underlying problem.

You get a list of `issues` (id, title, summary). They were grouped because their descriptions are similar, but similar is not the same: "scores not saving" and "class average is wrong" are both about results, but they are different problems.

Group the issues that are clearly the same problem, reported by different people or in different words.

Return JSON: `{"groups": [["<issue id>", "<issue id>"], ...]}`. Only include groups of two or more ids. Return `{"groups": []}` if no two are the same problem.
