'use strict';

require('console-augmenter');
console.logLevel(console.LL_LOG);

const path = require('path');
const es = require('event-stream');
const toposort = require('toposort');
const PluginError = require('plugin-error');

const PLUGIN_NAME = 'gulp-ext3order';

const filesMap = {};
const fileDeps = {};

const classNames = [];
const classDefs = {};
const classExtends = {};

module.exports = () => es.through(transform, flush);

/**
 * The transform function. Will not actually transform the streamed file but rather
 * add it to the list of files. The flush function will take care of reordering the
 * files and pushing them out in the correct order.
 * @param {Vinyl} file The Vinyl object (see https://github.com/gulpjs/vinyl) that
 * describes the file that was passed to the transform function
 */
const transform = function(file) {
	filesMap[file.path] = file;
	fileDeps[file.path] = [];

	if(!file.contents) {
		return this.emit('error', new PluginError(PLUGIN_NAME, file.relative + '" is empty.'));
	}
}

/**
 * The flush function will reorder all files and push them out in the correct order
 */
const flush = function() {
	// Analyse the files we gathered
	for ( const filePath in filesMap ) {
		analyse(filesMap[filePath]);
	}

	// Build the dependency tree
	buildDependencyTree();

	// Let toposort handle the sorting based on dependencies
	const graph = [];
	for ( const filepath in fileDeps ) {
		fileDeps[filepath].forEach(dep => graph.push([filepath, dep]));
	}
	let result = [];
	try {
		result = toposort(graph).reverse();
	} catch(e) {
		return this.emit('error', new PluginError(PLUGIN_NAME, e.message));
	}

	// Add the files without dependencies
	for ( const filePath in filesMap ) {
		if ( !result.includes(filePath) ) {
			result.push(filePath);
		}
	}

	//now push the files in the resulting order into the stream
	result.forEach(filepath => {
		this.emit('data', filesMap[filepath]);
	});

	this.emit('end');
}

const classPattern = /\W+@class\s+(.+)/;
const extendsPattern = /\W+@extends\s+(.+)/;
const dependsPattern = /\W+#dependsFile\s+(.+)/;

/**
 * Scans the contents of the given file to find class definitions
 * and class and file dependecies.
 * @param {Vinyl} file The Vinyl representation of the file that
 * should be analysed.
 */
const analyse = file => {
	const lines = file.contents.toString().split(/(?:\r\n|\r|\n)/g);
	if ( lines.length === 0 ) {
		return;
	}

	let matches;
	let className;
	lines.forEach(line => {

		// Check if the line contains a @class declaration
		if ( matches = classPattern.exec(line) ) {
			className = matches[1];
			classDefs[className] = file;
			classNames.push(className);
		}

		// Check if the line contains an @extends declaration
		if ( matches = extendsPattern.exec(line) ) {
			if ( className )
				if ( !Array.isArray(classExtends[className]) ) {
					classExtends[className] = [];
				}
				if ( !classExtends[className].includes(matches[1]) ) {
					classExtends[className].push(matches[1]);
				}
		}

		// Check if the line contains a #dependsFile declaration
		if ( matches = dependsPattern.exec(line) ) {
			const depFilePath = process.cwd() + path.sep + matches[1];
			if ( !fileDeps[file.path].includes(depFilePath) ) {
				fileDeps[file.path].push(depFilePath);
			}
		}
	});

	// Parse the files to find dependencies in the javascript
	const contentWithoutComments = removeComments(file.contents.toString());
	findExtendDeps(file, contentWithoutComments);
	findDefineDeps(file, contentWithoutComments)
};

/**
 * Builds a dependency map for all files based on found classes and dependecies.
 */
const buildDependencyTree = () => {
	classNames.forEach(className => {
		// Get the file path
		const filepath = classDefs[className].path;

		// Add dependencies from the @extends and Ext.extend code annotation
		if ( Array.isArray(classExtends[className]) ) {
			classExtends[className].forEach(extend => {
				if ( classDefs[extend] ) {
					if ( !Array.isArray(fileDeps[filepath]) ) {
						fileDeps[filepath] = [];
					}
					fileDeps[filepath].push(classDefs[extend].path);
				}
			});
		}
	});
};

/**
 * Scans a file for classes and dependencies based on Ext.extend
 * @param {Vinyl} file The Vinyl object that represents the file we're scanning
 * @param {String} fileContent The file contents without comments
 */
function findExtendDeps(file, fileContent) {

	// A regexp to find Ext.extend( in the file
	var extendRegexp = /([a-zA-Z0-9_\.]+)[\s|\n|\r]*=[\s|\n|\r]*Ext[\s|\n|\r]*\.extend[\s|\n|\r]*\([\s|\n|\r]*([a-zA-Z0-9_\.]+)/;
	var extendStartRe = /Ext[\s|\n|\r]*\.extend[\s|\n|\r]*\(/;

	// Set startIndex to the first found Ext.extend
	var startIndex = regexIndexOf(fileContent, extendRegexp);
	var tmpIndex = regexIndexOf(fileContent, extendStartRe, startIndex)

	// Set stopIndex to the next found Ext.extend (or -1 if not found)
	var stopIndex = regexIndexOf(fileContent, extendRegexp, tmpIndex+1);

	while(startIndex !== -1) {
		var extendContent, contentUntilStopIndex, contentUntilStopIndexCleared;
		if (stopIndex !== -1) {
			extendContent = fileContent.substr(startIndex, stopIndex-startIndex);
			contentUntilStopIndex = fileContent.substr(0, stopIndex);
			contentUntilStopIndexCleared = removeNotRequiredBracesFrom(contentUntilStopIndex);
		} else {
			extendContent = fileContent.substr(startIndex);
			contentUntilStopIndex = fileContent;
			contentUntilStopIndexCleared = removeNotRequiredBracesFrom(fileContent);
		}
		var braceDiffUntilStopIndex = Math.abs(countChars(contentUntilStopIndexCleared, '{') - countChars(contentUntilStopIndexCleared, '}'));

		//remove strings and regexp from content. They could be counted and cause brace count related bugs
		var strClearedContent = removeNotRequiredBracesFrom(extendContent);
		var openBraces = countChars(strClearedContent, '{');
		var closedBraces = countChars(strClearedContent, '}');

		console.debug("Counting braces in extend block: open braces = " + openBraces + ' closing braces: ' + closedBraces);

		if (openBraces === closedBraces) {
			console.debug('Open-close brace count in extend block is equal');

			const matches = extendContent.match(extendRegexp);
			const currentClass = matches[1];
			const extendClass = matches[2];

			// Don't add a dependency on itself
			if(braceDiffUntilStopIndex === 0 && currentClass !== extendClass ) {
				//dependencies[currentClass] = [matches[2]];
				if ( !Array.isArray(classExtends[currentClass]) ) {
					classExtends[currentClass] = [];
				}
				if ( !classExtends[currentClass].includes(extendClass) ) {
					classExtends[currentClass].push(extendClass);
				}

				console.debug('Adding class to dependencies: ' + currentClass);
				classDefs[currentClass] = file;
				classNames.push(currentClass);
			}

			if(stopIndex !== -1) {
				startIndex = regexIndexOf(fileContent, extendRegexp, stopIndex + 1);
			} else {
				startIndex = regexIndexOf(fileContent, extendRegexp, tmpIndex + 1);
			}

			tmpIndex = regexIndexOf(fileContent, extendStartRe, startIndex);
			stopIndex = regexIndexOf(fileContent, extendRegexp, tmpIndex + 1);
		} else {
			if(stopIndex !== -1) {
				tmpIndex = regexIndexOf(fileContent, extendStartRe, stopIndex);
				stopIndex = regexIndexOf(fileContent, extendRegexp, tmpIndex + 1);
			} else {
				tmpIndex = regexIndexOf(fileContent, extendStartRe, startIndex);
				startIndex = regexIndexOf(fileContent, extendRegexp, tmpIndex + 1);
			}
		}
	}
}

/**
 * Scans a file for classes and dependencies based on Ext.define
 * @param {Vinyl} file The Vinyl object that represents the file we're scanning
 * @param {String} fileContent The file contents without comments
 */
function findDefineDeps(file, fileContent) {
	// A regexp to find Ext.define( in the file
	var defineRegexp = /Ext[\s|\n|\r]*\.define[\s|\n|\r]*\(/;

	// Set startIndex to the first found Ext.define
	var startIndex = regexIndexOf(fileContent, defineRegexp);
	// Set stopIndex to the next found Ext.define (or -1 if not found)
	var stopIndex = regexIndexOf(fileContent, defineRegexp, startIndex+1);

	while(startIndex !== -1) {
		var defineContent, contentUntilStopIndex, contentUntilStopIndexCleared;
		if (stopIndex !== -1) {
			defineContent = fileContent.substr(startIndex, stopIndex-startIndex);
			contentUntilStopIndex = fileContent.substr(0, stopIndex);
			contentUntilStopIndexCleared = removeNotRequiredBracesFrom(contentUntilStopIndex);
		} else {
			defineContent = fileContent.substr(startIndex);
			contentUntilStopIndex = fileContent;
			contentUntilStopIndexCleared = removeNotRequiredBracesFrom(fileContent);
		}
		var braceDiffUntilStopIndex = Math.abs(countChars(contentUntilStopIndexCleared, '{') - countChars(contentUntilStopIndexCleared, '}'));

		//remove strings and regexp from content. They could be counted and cause brace count related bugs.
		var strClearedContent = removeNotRequiredBracesFrom(defineContent);
		var openBraces = countChars(strClearedContent, '{');
		var closedBraces = countChars(strClearedContent, '}');

		console.debug("Counting braces: open braces = " + openBraces + ' closing braces: ' + closedBraces);

		if (openBraces === closedBraces) {
			console.debug('Open-close brace count is equal');

			var currentClassWithApostrophes = defineContent.match(/Ext[\s|\n|\r]*\.[\s|\n|\r]*define[\s|\n|\r|\(]*?[\'|\"][a-zA-Z0-9_\.]*?[\'|\"]/);

			var extend = defineContent.match(/extend[\s|\n|\r]*:[\s|\n|\r]*[\'|\"][a-zA-Z\.\s]*[\'|\"]/);
			var override = defineContent.match(/override[\s|\n|\r]*:[\s|\n|\r]*[\'|\"][a-zA-Z\.\s]*[\'|\"]/);

			//parse classnames
			var currentClass = getClassNames(currentClassWithApostrophes)[0];
			var extendClasses = getClassNames(extend);
			const overrideClasses = getClassNames(override);

			var dependencyClasses = extendClasses.concat(overrideClasses);

			if(braceDiffUntilStopIndex === 0) {
				if ( !Array.isArray(classExtends[currentClass]) ) {
					classExtends[currentClass] = [];
				}
				classExtends[currentClass] = concatUnique(classExtends[currentClass], dependencyClasses);

				console.debug('Adding class: ' + currentClass);

				classDefs[currentClass] = file;
				classNames.push(currentClass);
			}

			if(stopIndex !== -1) {
				startIndex = regexIndexOf(fileContent, defineRegexp, stopIndex + 1);
			} else {
				startIndex = regexIndexOf(fileContent, defineRegexp, startIndex + 1);
			}

			stopIndex = regexIndexOf(fileContent, defineRegexp, startIndex + 1);
		} else {
			if(stopIndex !== -1) {
				stopIndex = regexIndexOf(fileContent, defineRegexp, stopIndex + 1);
			} else {
				startIndex = regexIndexOf(fileContent, defineRegexp, startIndex + 1);
			}
		}
	}
}

/**
 * Removes all strings (single or double quoted) and regular expressions from
 * the given string.
 * @param {String} str The string to remove strings and regexps from
 */
function removeNotRequiredBracesFrom(str) {
	return str.replace(/('.*?[^\\]'|".*?[^\\]"|\/.*?[^\\]\/)/gm, '')
}

function countChars(str, char) {
	var hist = {};
	for (var si in str) {
		hist[str[si]] = hist[str[si]] ? 1 + hist[str[si]] : 1;
	}
	return hist[char];
}

function getClassNames(stringWithClassNames) {
	var allClassNames = [];

	if(stringWithClassNames) {
		var i = 0;
		stringWithClassNames.forEach(function (req) {
			var classNames = req.match(/[\'|\"][a-zA-Z0-9_\.]+[\'|\"]/g);
			if(classNames) {
				classNames.forEach(function (c, index) {
					if (typeof index === "number") {
						allClassNames[i++] = c.substr(1, c.length - 2);
					}
				});
			}
		});
	}

	return allClassNames;
}

function concatUnique(arr1, arr2) {
	arr2.forEach(function(element) {
		if(arr1.indexOf(element) === -1) {
			arr1.push(element);
		}
	});
	return arr1;
}

//noinspection Eslint
function removeComments(content) {
	return content.replace(/(?:\/\*(?:[\s\S]*?)\*\/)|(?:([\s;])+\/\/(?:.*)$)/gm, '');
}

function regexIndexOf (str, regex, startpos) {
	var indexOf = str.substring(startpos || 0).search(regex);
	return (indexOf >= 0) ? (indexOf + (startpos || 0)) : indexOf;
}

