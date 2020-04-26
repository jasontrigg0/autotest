exports.main = function() {
  let number = parseFloat(rand().toFixed(4));
  number = number + parseFloat((rand()).toFixed(4));
  number = first(number);
  printResult(number);
  return number;
}

function first(i) {
  i *= 100;
  return second(i, 'sqrt');
}

function second(k, method) {
  return {raw: k, rounded: parseFloat(Math.sqrt(k).toFixed(4)), method: method};
}

//@impure
function printResult(res) {
  require('fs').appendFileSync('output.txt', JSON.stringify(res));
}

//@impure
function rand() {
  return Math.random();
}