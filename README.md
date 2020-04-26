# AutoTest (prototype)


The idea is to run instrumented code that automatically records function calls and their outputs. From these records automatically generate tests, and then refactors or other code edits can be tested to ensure that the new code produces the same outputs.


Usage:

```node main.js -f ./example.js #run exports.main from example.js and save the results for future testing```

```node main.js -f ./example.js --test #run previously generated tests on example.js```


Trouble with impure functions:
* Code with outside inputs (eg read from DB, RNG) could give different results with the same inputs.
* Code with side effects (eg write to DB) may not want to rerun this code in tests, it could corrupt the DB.

Solution:
Annotate these functions with `//@impure` and they'll be ignored by autotest. If other functions call the impure function, autotest will cache the results so they produce deterministic results and aren't rerun during testing.

Example:
```
function sometimesMultiply() {
  let i = 1;
  if (Math.random() < 0.5) i *= 10;
  return i;
}
```
If we run this function, find that the output is 1, and then run it again later to test, the test will fail half the time. The solution is to break out the random call into a separate function and annotate that as impure.
```
//@impure
function rand() {
  return Math.random();
}

function sometimesMultiply() {
  let i = 0;
  if (rand() < 0.5) i *= 10;
  return i;
}
```
Now if we run sometimesMultiply, autotest will save the result of the call to the impure function rand(). When testing later, autotest will use the stored value and give deterministic results.

Solution:

Annotate these functions with `//@sideEffect` and they'll be ignored by autotest. Furthermore, if other functions call the side effect function, autotest will cache the results so they aren't rerun during testing.
