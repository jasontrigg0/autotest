let Papa = require('papaparse');
let fs = require('fs');
const readline = require('readline');
let util = require('util');
let ArgumentParser = require('argparse');

function readCL() {
  let parser = new ArgumentParser.ArgumentParser();
  parser.addArgument(['-f','--file'], {required: true});
  parser.addArgument(['--test'], {help: 'run automatically generated tests on the input file', action: 'storeTrue'});
  let args = parser.parseArgs();
  return args;
}

//HACK: can't distinguish between Infinity, "Infinity" or between NaN, "NaN"
function serialize(o) {
  return JSON.stringify(o, function(key, value) {
    if (value === Infinity) {
      return "Infinity";
    } else if (value === -Infinity) {
      return "-Infinity";
    } else if (value !== value) {
      return "NaN";
    }
    return value;
  });
}

function deserialize(o) {
  return JSON.parse(o, function(key, value) {
    if (value === "Infinity") {
      return Infinity;
    } else if (value === "-Infinity") {
      return -Infinity;
    } else if (value === "NaN") {
      return NaN;
    }
    return value;
  });
}

async function getImpureFns() {
  let files = ['/home/jtrigg/git/autotest/example.js'];
  let impureFns = [];
  for (let file of files) {
    let impureAnnotation = false;
    let lineCount = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      lineCount += 1;
      if (impureAnnotation) {
        regex = /function (\w+)\(/;
        if (line.match(regex)) {
          let fnName = line.match(regex)[1];
          impureFns.push(`${fnName}@${file}::${lineCount}`);
        }
      }
      impureAnnotation = !!line.match(/@impure/g);
    };
  }
  return impureFns;
}

function readCsv(path, callback) {
  fs.readFile(path, 'utf8', function(err, data) {
    Papa.parse(data, {
      complete: function(results) {
        callback(results.data);
      },
    });
  });
}

function generateTestFile(path, testFile) {
  readCsv(path, function(data) {
    fs.writeFileSync(testFile, "let rewire = require('rewire')\n");
    data.forEach(function(row) {
      if (row.length === 1 && row[0] === "") return; //skip empty rows
      let [fn, args, impures, ret, exception] = row;
      args = deserialize(args);
      impures = deserialize(impures);
      ret = deserialize(ret);
      fs.appendFileSync(testFile, generateTest(fn, args, impures, ret, exception));
    });
  });
}

function generateTest(fn, args, impures, ret, exception) {
  let functionName = fn.split("@")[0];
  let fileName = fn.split("@")[1].split("::")[0];

  let conditionString;
  if (exception === "true") {
    let conditionFormat = 'expect(file.__get__("%s").bind(null,...%s)).toThrow();';
    conditionString = util.format(conditionFormat, functionName, args);
  } else if (ret === null) {
    //HACK: njsTrace records both no output (ie undefined) and null output to null
    //so check that the output is either null or undefined
    let conditionFormat = 'expect([null, undefined]).toContain(file.__get__("%s")(...%s));';
    conditionString = util.format(conditionFormat, functionName, args);
  } else {
    let conditionFormat = 'expect(file.__get__("%s")(...%s)).toEqual(%s);';
    conditionString = util.format(conditionFormat, functionName, args, ret);
  }


  let impureCode = "";

  for (let impureFn in impures) {
    let impureFnName = impureFn.split("@")[0];
    impureCode += `  file.__set__("${impureFnName}", (function() {
  let counter = 0;
  let returnValues = ${serialize(impures[impureFn])};
  return function() {
    let value = returnValues[counter];
    counter += 1;
    return value;
  }
})())
`;
  }

  let format = `describe("%s", function() {
  let file = rewire("%s");
${impureCode}
  it('', function() {
    %s
  });
});
`

  //example:
  //[file, fn, args] = [ '"/home/jtrigg/github/njsTrace/test/mocks/file2.js"',
  //'"a"',
  //'["boB"]' ]
  //testName = "/home/jtrigg/github/njsTrace/test/mocks/file2.js,a,boB"
  let testNameList = [fileName, functionName,[args]];
  let testName = testNameList.join(','); //.replace(/\"/g,"\\\"");
  return util.format(format, testName, fileName, conditionString);
}

async function test(fnOutputFile) {
  //run jasmine on the generated test cases
  let child_process = require('child_process');
  let testFile = './test/autotest.js';
  generateTestFile(fnOutputFile, testFile);
  let jasmine = child_process.exec('jasmine ' + testFile);
  jasmine.stdout.on('data', (data) => {
    console.log(data);
  });
  jasmine.stderr.on('data', (data) => {
    console.log("ERROR!");
    console.log(data);
  });
}

// Get a reference to njstrace default Formatter class
let Formatter = require('njstrace/lib/formatter.js');

// Create my custom Formatter class
class AutoTestFormatter {
  constructor(outputFile) {
    this.stack = [];
    this.outputFile = outputFile;
    //let impureFns = ['rand@/home/jtrigg/git/autotest/mymod.js::24','printResult@/home/jtrigg/git/autotest/mymod.js::19'];
  }
  async setImpureFns() {
    this.impureFns = await getImpureFns();
  }
}

// But must "inherit" from Formatter
require('util').inherits(AutoTestFormatter, Formatter);

// Implement the onEntry method
AutoTestFormatter.prototype.onEntry = function(args) {
  this.stack.push({
    fn: `${args.name}@${args.file}::${args.line}`,
    impures: {},
    args: args.args
  });
};

// Implement the onExit method
AutoTestFormatter.prototype.onExit = function(args) {
  let entry = this.stack.pop();

  let fn = `${args.name}@${args.file}::${args.line}`;

  if (this.impureFns.indexOf(fn) !== -1) {
    for (let e of this.stack) {
      e.impures[fn] = e.impures[fn] || [];
      e.impures[fn].push(args.returnValue);
    }
  }

  if (fn !== entry.fn) {
    console.log("ERROR: stack inconsistency");
    console.log(args);
    console.log(entry);
  }

  let fnval = {
    fn: fn,
    args: serialize(entry.args),
    impures: serialize(entry.impures),
    returnValue: serialize(args.returnValue),
    exception: args.exception
  };

  let header = ["fn", "args", "impures", "returnValue", "exception"];

  let row = [];
  for (let x of header) {
    row.push(fnval[x]);
  }

  if (this.impureFns.indexOf(fn) === -1) {
    fs.appendFileSync(this.outputFile, Papa.unparse([row]) + "\n");
  }
};


async function main() {
  let args = readCL();

  let fnOutputFile = './test/outputs.csv';
  if (!fs.existsSync('./test')){
    fs.mkdirSync('./test');
  }

  if (args.test) {
    await test(fnOutputFile);
  } else {
    let formatter = new AutoTestFormatter(fnOutputFile);
    await formatter.setImpureFns();

    let njstrace = require('njstrace').inject({formatter});

    require(args.file).main();
  }

}

main();