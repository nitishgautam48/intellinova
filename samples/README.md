# Sample material and test set

Use these to try the tutor and the evaluation harness end to end.

1. **Admin › Curriculum**: have a Science subject with an *Electricity* chapter (the demo data already has one).
2. **Admin › Knowledge base › Upload**: upload `IntelliNova-sample-Electricity.pdf` to that subject and let it process.
3. **Admin › Evaluation › Test set › Import**: choose `eval-testset-electricity.csv` and the same subject.
   It has 22 questions with the page each answer is on, and 4 off-material questions the tutor should decline.
4. **Admin › Evaluation › Question bank**: *Prepare* so the simulated-student test runs on the real quiz engine.
5. **Admin › Evaluation › Results**: pick RAGAS, DeepEval or TruLens and *Run evaluation*. Download the report
   (Markdown or CSV) when it finishes.

Write your own test set in the same CSV format (Evaluation › Test set › Import › *CSV template*), or use
*Draft from material* and then check and edit what it wrote.
