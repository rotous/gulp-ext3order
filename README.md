# gulp-ext3order

A gulp module that will order javascript files that use the ExtJS 3.4 framework

All files that are passed to the plugin will be scanned for class definitions and dependencies between
themselves.

## Installation
```
npm install --save-dev gulp-ext3order
```

Use the plugin in your gulp pipeline as any other plugin:

```
const gulp = require('gulp');
const order = require('gulp-ext3order');
const concat = require('gulp-concat');

/*
 * A task to reorder and concatenate our javascript files
 */
gulp.task('scripts-concat', function(){
    return gulp.src(['js/**/*.js'])   // use all js files found in the js dir and subdirs
        .pipe(order())                // reorder the files according to their dependencies
        .pipe(concat('debug.js'))     // concat the files
        .pipe(gulp.dest('./deploy/')) // save the output to the deploy directory
});

```

## Class definitions
The plugin will scan for the following constructs that denote class definitions:

- `<CLASSNAME> = Ext.extend(..., ...)`
- `Ext.define('<CLASSNAME>', ...)`
- `@class <CLASSNAME>`

The `@class` construct makes it possible to add annotations in (doc)comments to make a the plugin
aware of a class that it wouldn't find otherwise. This makes it possible to denote a plain object
as a class. E.g.:

```
/**
 * @class MySuperDuperClass
 */
 const MySuperDuperClass = {
	 ...
 };
```

## Dependencies
The plugin will scan for the following constructs that denote dependencies:

- `<CLASS A> = Ext.extend(<CLASS B>, ...)`
- `Ext.define(<CLASS A>, { extend: <CLASS B>, ... })`
- `Ext.define(<CLASS A>, { override: <CLASS B>, ... })`
- `@extends <CLASSNAME>`
- `#dependsFile <FILEPATH>`

The `@extends` and `#dependsFile` make it possible to explicitly specify class and file dependencies
for the containing file.

## Example
For an example of the plugin please see the [test](./test/) directory.

## License
[AGPL 3](AGPL-3)
