"use strict"

const {series, src, dest} = require('gulp');
const del = require('del');
const order = require('gulp-ext3order');
const concat = require('gulp-concat');

/*
 * The clean task. Will delete the deploy directory
 */
const clean = () => del(['deploy']);
exports.clean = clean;

/*
 * A task to reorder and concatenate our javascript files
 */
const scriptsConcat = () =>
	src(['mocks/**/*.js'])
	    .pipe(order())
	    .pipe(concat('debug.js'))
	    .pipe(dest('./deploy/'));
exports['script-concat'] = scriptsConcat;

/*
 * The default task that will be run if gulp is run without any additional parameters
 */
const defaultTask = series(clean, scriptsConcat);
exports.default = defaultTask;
