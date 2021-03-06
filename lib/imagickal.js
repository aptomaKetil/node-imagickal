'use strict';
var Promise = require('bluebird'),
	exec = require('child_process').exec,
	printf = require('util').format,
	ImageMagickCommands = require('./commands'),
	debug = require('debug')('imagickal');

var globalOpts = {};

/**
 * Parse output from identify returning record for the first image in sequence
 * The parsed data will contain an extra attribute "images" indicating number of images.
 * @param  {String} output
 * @throws {Error} If unable to parse output
 * @return {Object}
 */
function parseOutput(output) {
	var matches,
		data,
		json,
		images = 0,
		regx = /(\{[^\}]+\})/g;

	while ((matches = regx.exec(output)) !== null) {
		if (!data) {
			data = matches[1];
		}
		images++;
	}

	if (!data) {
		throw new Error();
	}

	try {
		json = JSON.parse(data);
		if (typeof(json) !== 'object') {
			throw new Error();
		}
	} catch (e) {
		throw new Error();
	}

	json.images = images;
	return json;
}

/**
 * Get Dimensions from an image file.
 * Returns only dimensions for the first image if the image file contains a sequence of images.
 * @param  {String}   path full path to the file
 * @param {Function} [callback] results in format {width:,height:,images:}
 *                     images attriube shows number of images in sequence. eg for an animated gif
 * @return {Promise} resolved with {width:,height:}
 *                     images attriube shows number of images in sequence. eg for an animated gif
 */
var dimensions = exports.dimensions = function (path, callback) {
	var defer = Promise.defer(),
		cmd = 'identify -format "{\\"width\\":%w,\\"height\\":%h}" ' + path;
	debug('dimensions', cmd);
	exec(cmd, function (err, stdout) {
		if (err) {
			return defer.reject(err);
		}

		try {
			defer.resolve(parseOutput(stdout.toString()));
		} catch (e) {
			return defer.reject(new Error('Unable to parse dimensions from output: ' + stdout.toString()));
		}
	});
	return defer.promise.nodeify(callback);
};

/**
 * Identify image format & dimensions on a image.
 * This will also verify that the image file is not corrupt.
 * This will only be done on the first image if the image file contains a sequence of images.
 * @param  {String} path
 * @param  {Boolean|Function} [verifyImage] use verbose in identify command to check image for corruption.
 *                                          Callback can be passed as this parameter.
 * @param {Function} [callback] result in format {format:, width:, height:, images:}
 *                     images attriube shows number of images in sequence. eg for an animated gif
 * @return {Promise} - resolved with {format:, width:, height:, images:}
 *                     images attriube shows number of images in sequence. eg for an animated gif
 */
exports.identify = function (path, verifyImage, callback) {
	if (typeof(verifyImage) === 'function') {
		callback = verifyImage;
		verifyImage = false;
	}

	var defer = Promise.defer(),
		cmd = printf(
			'identify -format "{\\"format\\":\\"%m\\",\\"width\\":%w,\\"height\\":%h}" %s%s',
			verifyImage ? '-verbose ' : '',
			path
		);

	debug('identify', cmd);
	exec(cmd, function (err, stdout) {
		if (err) {
			if (err.message.match(/decode delegate/)) {
				return defer.reject(new Error('Invalid image file'));
			}
			return defer.reject(err);
		}

		var data;
		try {
			data = parseOutput(stdout.toString());
			data.format = data.format.toLowerCase();
			data.format = data.format === 'jpeg' ? 'jpg' : data.format;
		} catch (e) {
			return defer.reject(new Error('Unable to parse identify data, output was:' + stdout.toString()));
		}

		if (!data) {
			return defer.reject(new Error('Unable to identify image, output was:' + stdout.toString()));
		}

		defer.resolve(data);
	});
	return defer.promise.nodeify(callback);
};

/**
 * Create new ImageMagickCommands instances
 * @param {Object} [opts] if specified it not use any of the global options set by setDefaults()
 * @param {String} [opts.executable] path/command for convert.
 * @return {ImageMagickCommands}
 */
var commands = exports.commands = function (opts) {
	return new ImageMagickCommands(opts || globalOpts);
};


/**
 * TRANSFORMATION
 */

var commandKeys = [ 'strip', 'quality', 'resize', 'rotate', 'sharpen', 'crop', 'gravity' ];

/**
 * Create ImageMagickCommands object and apply actions on it.
 * @param  {Object} actions
 * @return {ImageMagickCommands}
 */
function applyActions(actions) {
	var cmds = commands();
	Object.keys(actions).forEach(function (action) {
		if (commandKeys.indexOf(action) < 0) {
			return;
		}
		cmds[action](actions[action]);
	});
	return cmds;
}

/**
 * Calculate new dimensions on image after transformation based on its actions.
 * @param  {Object} actions
 * @param  {Integer} origWidth
 * @param  {Integer} origHeight
 * @return {Object} {width:, height:}
 */
function calculateNewDimensions(actions, origWidth, origHeight) {
	if (actions.resize && actions.resize.width && actions.resize.height) {
		return { width: actions.resize.width, height: actions.resize.height };
	}

	if (actions.resize && actions.resize.width) {
		return {
			width: actions.resize.width,
			height: Math.ceil(origHeight / origWidth * actions.resize.width)
		};
	}

	if (actions.resize && actions.resize.height) {
		return {
			width: Math.ceil(origWidth / origHeight * actions.height),
			height: actions.height
		};
	}

	if (actions.crop) {
		return { width: actions.crop.width, height: actions.crop.height };
	}

	return { width: origWidth, height: origHeight };
}

/**
 * Transform image
 * @param  {String} src
 * @param  {String} dst
 * @param  {Object} actions
 * @param  {Function} [callback]
 * @return {Promise} resolved promise with dst as value
 */
exports.transform = function (src, dst, actions, callback) {
	if (actions.sharpen && actions.sharpen.mode === 'variable') {
		return dimensions(src).then(function (dim) {
			var newDim = calculateNewDimensions(actions, dim.width, dim.height),
				moddedActions = JSON.parse(JSON.stringify(actions));
			moddedActions.sharpen.width = newDim.width;
			moddedActions.sharpen.height = newDim.height;
			return applyActions(moddedActions).exec(src, dst, callback);
		});
	} else {
		return applyActions(actions).exec(src, dst, callback);
	}
};

/**
 * Set default options to be passed to ImageMagickCommands.
 * @param {Object} opts
 */
exports.setDefaults = function (opts) {
	globalOpts = opts;
};
