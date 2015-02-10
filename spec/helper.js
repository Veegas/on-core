/*globals global,require,__dirname */
'use strict';

// Set a global test environment.
process.env.NODE_ENV = 'test';

var path = require('path');

/**
 *  set up global request mocking library supertest as request
 */
global.request = require('supertest');

/**
 *  set up global sinon for use as a spy and ensure initialized before
 *  invoking sinon-chai extension to chai.
 */
global.sinon = require('sinon');
global.sinonPromise = require('sinon-promise')(global.sinon);

/**
 *  set up global chai for testing
 */
global.chai = require('chai');
global.chai.use(require('chai-as-promised'));
global.chai.use(require('sinon-chai'));

/**
 *  set up global expect for testing
 */
global.expect = chai.expect; // jshint ignore:line

/**
 *  set up global should for testing
 */
global.should = chai.should(); // jshint ignore:line

/**
 *  set up di for testing
 */
var di = require('di');
var dihelper = require('../lib/di')(di, __dirname);

/**
 *  set up global lodash as _ for testing
 */
global._ = require('lodash');
global.Q = require('q');

function provider(object) {
    var provides = _.detect(object.annotations, function (annotation) {
        return _.has(annotation, 'token');
    });

    return provides ? provides.token : undefined;
}

global.helper = {

/**
 * Helper for requiring files based on the cwd which is the root of the project.
 */
    require: function (file) {
        return require(this.relativeToRoot(file));
    },

/**
 * Helper for glob requiring files based on the cwd which is the root of the project.
 */
    requireGlob: function (pathPattern) {
        return dihelper.requireGlob(this.relativeToRoot(pathPattern));
    },

/**
 * Helper to generate a full path relative to the root directory.
 */
    relativeToRoot: function (file) {
        return path.normalize(process.cwd() + file);
    },
/**
 * Most commonly used classes / modules, override or extend as needed
 * with child injector
 */
    di: dihelper,

    injector: undefined,

    start: function (overrides) {
        var self = this;
        // Setup test injector.
        this.setupInjector(overrides);

        // Setup core configuration.
        this.setupTestConfig();

        // Start the core services.
        return this.injector.get('Services.Core').start().then(function (core) {
            self.core = core;
        });
    },

    setupInjector: function (overrides) {
        // Start with the core dependencies.
        var dependencies = require('../index')(di, '..').injectables;

        // If overrides are provided then we'll process those before
        // creating the injector.
        if (overrides !== undefined) {
            // Overrids could be a single or an array so treat them
            // as equivalents by flattening.
            _.flatten([overrides]).forEach(function (override) {
                // Get the provider string for the current override.
                var provides = provider(override);

                if (provides) {
                    // Remove any matching dependencies from the core
                    // depdencies.
                    _.remove(dependencies, function (dependency) {
                        var p = provider(dependency);

                        return p && p === provides;
                    });
                }

                // Push the new dependency onto the list of dependencies.
                dependencies.push(override);
            });
        }

        // Initialize the injector with the new list of dependencies.
        return this.injector = new di.Injector(dependencies);
    },

    /**
     * Sets up values in the configuration service to testing - using AMQP and a test
     * MongoDB database
     *
     * @returns {Q.promise}
     */
    setupTestConfig: function () {
        return this.injector.get(
            'Services.Configuration'
        ).set('mongo', {
            host: 'localhost',
            port: 27017,
            database: 'renasar-pxe-test',
            user: '',
            password: ''
        }).set(
            'amqp', 'amqp://localhost'
        );
    },

    /**
     * maps through all collections loaded into Services.Waterline
     * and destroys them to reset testing state.
     *
     * Usage:
     *
     *     beforeEach(function() {
     *         this.timeout(5000); // gives the system 5 seconds to do the wiping
     *         return waterline.start().then(function() {
     *             return helper.reset();
     *         })
     *     })
     *
     * @returns {Q.promise}
     */

    reset: function () {
        var waterline = this.injector.get('Services.Waterline'),
            Q = this.injector.get('Q'),
            _ = this.injector.get('_');

        return Q.all(
            _.map(waterline, function (collection) {
                if (typeof collection.destroy === 'function') {
                    return collection.destroy({});
                }
            })
        );
    },

    /**
     * Invokes core.stop() if this.core exists to shut down services
     *
     * @returns {Q.promise}
     */
    stop: function () {
        if (this.core) {
            return this.core.stop();
        } else {
            return Q.resolve();
        }
    },

    /**
     *
     * @param callback
     *
     * Sets up a mocha "before" block that provides an opportunity to override
     * modules in the injector and then starts relevant services.
     *
     * Usage:
     *
     *     helper.before(function(context) {
     *       context.someMock = {
     *         mockedFunction: sinon.stub().yields()
     *       }
     *
     *       return helper.di.simpleWrapper(context.someMock, 'injectorName')
     *     });
     *
     * or
     *
     *     helper.before();
     *
     * This creates a mock object for one of the components you'd normally get
     * through the injector and by returning it at the tail end of the
     * helper.before(), it force loads the mock you made into the injector as
     * an updated item. (i.e. it passes the return value through as the
     * variable "overrides" into helper.start(), which in turn passes it down
     * helper.setupInjector() to do the shimming.
     *
     * You can return a single thing to be overridden, or you can return an
     * array of overrides, and the helper will shim in the item or list of
     * items respectively.
     *
     * If you just invoke helper.before() with no callback included, it'll just
     * do the work of invoking helper.start() to initialize connections and
     * services needed for the modules.
     */

    before: function (callback) {
        before(function () {
            this.timeout(10000);
            var Q = require('q');
            if (_.isFunction(callback)) {
                return Q.resolve(callback(this)).then(helper.start.bind(helper));
            } else {
                return helper.start();
            }
        });
    },

    /**
     * Usage:
     *
     *     helper.after();
     *
     * Sets up a mocha "after" function for the describe block in a spec that
     * does the relevant shutdown of core services.
     */
    after: function () {
        after(function () {
            return helper.stop();
        });
    }
};

