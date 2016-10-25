'use strict';

var es = require('event-stream');
var TopoSort = require('topo-sort');
var gutil = require('gulp-util');
var PluginError = gutil.PluginError;

var PLUGIN_NAME = 'gulp-ext3order';

//debugging flags
var debug = {
	enabled : false,
	showContent : false
};

/**
 * this file just make sure that the test will work
 */
exports['gulp-ext3order'] = function () {
	var files = {};
	var filesWithoutClass = [];
	var referencesFilesMap = {};
	var tsort = new TopoSort();

	var filesMap = {};
	var fileDeps = {};
	var totalFileCount = 0;

	var dependencies = {};
	var addedClasses = [];

	return es.through(function collectFilesToSort (file) {
		filesMap[file.path] = file;
		fileDeps[file.path] = [];
		var fileAdded = false;
		totalFileCount++;

		if(debug.enabled) {
			console.log("Parsing file: " + file.relative + '\n' );

			if(debug.showContent) {
				console.log("Content: " + file.contents.toString() + '\n' );
			}
		}

		if(!file.contents) {
			return this.emit('error', new PluginError(PLUGIN_NAME, 'File: "' + file.relative + '" is empty. You have to read it with gulp.src(..)'));
		}

		var fileContent = file.contents.toString();

		// Find dependencies based on #FileDepends
		fileAdded = fileAdded | findFileDeps(fileContent, dependencies, files, file, referencesFilesMap);

		// Find dependencies based on @extends tag
		fileAdded = fileAdded | findDepsByExtendTag(fileContent, dependencies, files, file, referencesFilesMap);

		fileContent = removeComments(fileContent);

		if(debug.enabled && debug.showContent) {
			console.log("Content with no comments: " + fileContent + '\n' );
		}

		// Find dependencies based on Ext.extend
		fileAdded = fileAdded | findExtendDeps(fileContent, dependencies, files, file, referencesFilesMap);

		// Find dependencies based on Ext.define
		fileAdded = fileAdded | findDefineDeps(fileContent, dependencies, files, file, referencesFilesMap);

		// Now add the file if it wasn't added because it contains a define or extend
		if ( !fileAdded ){
			filesWithoutClass.push(file);
		}

	}, function afterFileCollection () {
		// Now we have all dependencies, let's do the sorting

		// Create the file dependecies
		Object.keys(referencesFilesMap).forEach(function(filePath){
			if ( !fileDeps[filePath] ) {
				fileDeps[filePath] = [];
			}
			if ( referencesFilesMap[filePath] ){
				referencesFilesMap[filePath].forEach(function(refClassName) {
					dependencies[refClassName].forEach(function(depClassName){
						if ( files[depClassName] ){
							fileDeps[filePath] = concatUnique(fileDeps[filePath], [files[depClassName].path]);
						}
					});
				});
		   	}
		});

		// Let TopoSort handle the sorting based on dependencies
		for ( var filePath in fileDeps ){
			tsort.add(filePath, fileDeps[filePath]);
		}

		try {
			var result = tsort.sort().reverse();
		} catch(e) {
			return this.emit('error', new PluginError(PLUGIN_NAME, e.message));
		}

		var emittedFileCount = 0;

		// Now the files that depend on other files
		result.forEach(function (filePath) {
			this.emit('data', filesMap[filePath]);
			emittedFileCount++;
		}.bind(this));


		this.emit('end');
	});

	/**
	 * Scans a file for dependencies based on Ext.extend
	 * @param {String} fileContent
	 * @param {Object} dependencies
	 */
	function findExtendDeps(fileContent, dependencies, files, file, referencesFilesMap) {
		var fileAdded = false;

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

			//remove strings and regexp from content. They could be counted and cause brace count related bugs.
			var strClearedContent = removeNotRequiredBracesFrom(extendContent);
			var openBraces = countChars(strClearedContent, '{');
			var closedBraces = countChars(strClearedContent, '}');

			if(debug.enabled) {
				console.log("Counting braces in extend block: open braces = " + openBraces + ' closing braces: ' + closedBraces + '\n' );
			}

			if (openBraces === closedBraces) {

				if(debug.enabled) {
					console.log('Open-close brace count in extend block is equal' + '\n');
				}

				var matches = extendContent.match(extendRegexp);
				var currentClass = matches[1];

				// Don't add a dependency on itself
				if(braceDiffUntilStopIndex === 0 && currentClass !== matches[2] ) {
					dependencies[currentClass] = [matches[2]];

					if(debug.enabled) {
						console.log('Adding class to dependencies: ' + currentClass + '\n');
					}

					files[currentClass] = file;
					fileAdded = true;

					//put all file paths in a map, and update all concat all dependencies
					if(!referencesFilesMap[file.path]) {
						referencesFilesMap[file.path] = [currentClass];
					} else {
						referencesFilesMap[file.path].forEach(function(refClassName) {
							dependencies[refClassName] = concatUnique(dependencies[refClassName], dependencies[currentClass]);
							dependencies[currentClass] = concatUnique(dependencies[currentClass], dependencies[currentClass]);
						});
					}
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

		return fileAdded;
	}

	/**
	 * Scans a file for dependencies based on #dependsFile
	 * @param {String} fileContent
	 * @param {Object} dependencies
	 */
	function findFileDeps(fileContent, dependencies, files, file, referencesFilesMap) {
		var fileAdded = false;

		// A regexp to find Ext.extend( in the file
		var dependsRegexp = /#dependsFile[\s|\n|\r]+([a-zA-Z0-9_\/\\\.]+)/;

		// Set startIndex to the first found Ext.extend
		var startIndex = regexIndexOf(fileContent, dependsRegexp);
		// Set stopIndex to the next found Ext.extend (or -1 if not found)
		var stopIndex = regexIndexOf(fileContent, dependsRegexp, startIndex+1);

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

			//remove strings and regexp from content. They could be counted and cause brace count related bugs.
			var strClearedContent = removeNotRequiredBracesFrom(extendContent);
			var openBraces = countChars(strClearedContent, '{');
			var closedBraces = countChars(strClearedContent, '}');

			if(debug.enabled) {
				console.log("Counting braces in extend block: open braces = " + openBraces + ' closing braces: ' + closedBraces + '\n' );
			}

			if (openBraces === closedBraces) {

				if(debug.enabled) {
					console.log('Open-close brace count in extend block is equal' + '\n');
				}

				var matches = extendContent.match(dependsRegexp);
				var dependFile = process.cwd() + '/' + matches[1];
				fileDeps[file.path] = concatUnique(fileDeps[file.path], [dependFile]);

				if ( file.path.indexOf('AddressBookHierarchyRecord.js')>=0 ){
					console.log('start-stop = '+startIndex+' - '+stopIndex)
				}

				if(stopIndex !== -1) {
					startIndex = stopIndex;
				} else {
					startIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);
				}

				stopIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);

				if ( file.path.indexOf('AddressBookHierarchyRecord.js')>=0 ){
					console.log('new start-stop = '+startIndex+' - '+stopIndex)
				}

			} else {
				if(stopIndex !== -1) {
					stopIndex = regexIndexOf(fileContent, dependsRegexp, stopIndex + 1);
				} else {
					startIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);
				}
			}
		}

		return fileAdded;
	}

	function findDepsByExtendTag(fileContent, dependencies, files, file, referencesFilesMap) {
		var fileAdded = false;

		// A regexp to find Ext.define( in the file
		var dependsRegexp = /\/\*\*[^/]*?@class[\s|\n|\r]+([a-zA-Z0-9_\.]+)[\s|\n|\r]+[^/]*?@extends[\s|\n|\r]+([a-zA-Z0-9_\.]+)[^/]*?\*\//;

		// Set startIndex to the first found @extends comment block
		var startIndex = regexIndexOf(fileContent, dependsRegexp);
		// Set stopIndex to the next found Ext.define (or -1 if not found)
		var stopIndex = regexIndexOf(fileContent, dependsRegexp, startIndex+1);

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
			var openBraces = countChars(defineContent, '{');
			var closedBraces = countChars(defineContent, '}');

			if(debug.enabled) {
				console.log("Counting braces: open braces = " + openBraces + ' closing braces: ' + closedBraces + '\n' );
			}

			if (openBraces === closedBraces) {

				if(debug.enabled) {
					console.log('Open-close brace count is equal' + '\n');
				}

				var matches = defineContent.match(dependsRegexp);

				var currentClass = matches[1];
				var dependencyClasses = [matches[2]];

				if(braceDiffUntilStopIndex === 0) {
					dependencies[currentClass] = dependencyClasses;

					if(debug.enabled) {
						console.log('Adding class to dependencies: ' + currentClass + '\n');
					}

					files[currentClass] = file;
					fileAdded = true;

					//put all file paths in a map, and update all concat all dependencies
					if(!referencesFilesMap[file.path]) {
						referencesFilesMap[file.path] = [currentClass];
					} else {
						referencesFilesMap[file.path].forEach(function(refClassName) {
							dependencies[refClassName] = concatUnique(dependencies[refClassName], dependencies[currentClass]);
							dependencies[currentClass] = concatUnique(dependencies[currentClass], dependencies[currentClass]);
						});
					}
				}

				if(stopIndex !== -1) {
					startIndex = regexIndexOf(fileContent, dependsRegexp, stopIndex + 1);
				} else {
					startIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);
				}

				stopIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);
			} else {
				if(stopIndex !== -1) {
					stopIndex = regexIndexOf(fileContent, dependsRegexp, stopIndex + 1);
				} else {
					startIndex = regexIndexOf(fileContent, dependsRegexp, startIndex + 1);
				}
			}
		}

		return fileAdded;
	}

	function findDefineDeps(fileContent, dependencies, files, file, referencesFilesMap) {
		var fileAdded = false;

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

			if(debug.enabled) {
				console.log("Counting braces: open braces = " + openBraces + ' closing braces: ' + closedBraces + '\n' );
			}

			if (openBraces === closedBraces) {

				if(debug.enabled) {
					console.log('Open-close brace count is equal' + '\n');
				}

				var currentClassWithApostrophes = defineContent.match(/Ext[\s|\n|\r]*\.[\s|\n|\r]*define[\s|\n|\r|\(]*?[\'|\"][a-zA-Z0-9_\.]*?[\'|\"]/);

				var requirements = defineContent.match(/requires[.|\n|\r|\s]*:[\s|\n|\r|]*[\[]*[a-zA-Z0-9|\n|\r|\'|\"|\s|\.|,|\/]*[\]]*/);
				var mixins = defineContent.match(/mixins[.|\n|\r| ]*:[\s|\n|\r][\{|\[]+(.|\n|\r)*?(\}|\])+/);
				var extend = defineContent.match(/extend[\s|\n|\r]*:[\s|\n|\r]*[\'|\"][a-zA-Z\.\s]*[\'|\"]/);
				var model = defineContent.match(/model[\s|\n|\r]*:[\s|\n|\r]*[\'|\"][a-zA-Z\.\s]*[\'|\"]/);

				//parse classnames
				var currentClass = getClassNames(currentClassWithApostrophes)[0];
				var reqClasses = getClassNames(requirements);
				var extendClasses = getClassNames(extend);
				var mixinClasses = getClassNames(mixins);
				var modelClass = getClassNames(model);

				var dependencyClasses = mixinClasses.concat(extendClasses).concat(reqClasses).concat(modelClass);

				if(braceDiffUntilStopIndex === 0) {
					dependencies[currentClass] = dependencyClasses;

					if(debug.enabled) {
						console.log('Adding class to dependencies: ' + currentClass + '\n');
					}

					files[currentClass] = file;
					fileAdded = true;

					//put all file paths in a map, and update all concat all dependencies
					if(!referencesFilesMap[file.path]) {
						referencesFilesMap[file.path] = [currentClass];
					} else {
						referencesFilesMap[file.path].forEach(function(refClassName) {
							dependencies[refClassName] = concatUnique(dependencies[refClassName], dependencies[currentClass]);
							dependencies[currentClass] = concatUnique(dependencies[currentClass], dependencies[currentClass]);
						});
					}
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

		return fileAdded;
	}

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

	function sortObjectByKey (obj){
		var keys = [];
		var sorted_obj = {};

		for(var key in obj){
			if(obj.hasOwnProperty(key)){
				keys.push(key);
			}
		}

		// sort keys
		keys.sort();

		// create new array based on Sorted Keys
		keys.forEach(function(key) {
			sorted_obj[key] = obj[key];
		});

		return sorted_obj;
	}
};