'use strict';
const fs = require('node:fs');
const csso = require('csso');

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node minify-css.js input.css output.css');
fs.writeFileSync(output, csso.minify(fs.readFileSync(input, 'utf8')).css, 'utf8');
