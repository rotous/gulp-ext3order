"use strict"

var gulp = require('gulp');
var del = require('del');
var order = require('gulp-ext3order');
var concat = require('gulp-concat');

/*
 * The default task that will be run if gulp is run without any additional parameters
 */
gulp.task('default', ['clean', 'scripts-concat'], function() {
});


gulp.task('clean', function(){
	return del([
		'deploy'
	]);
});

/*
 * A task to reorder and concatenate our javascript files
 */
gulp.task('scripts-concat', function(){
	return gulp.src(['mocks/**/*.js'])
	    .pipe(order())
	    .pipe(concat('debug.js'))
	    .pipe(gulp.dest('./deploy/'))
});

