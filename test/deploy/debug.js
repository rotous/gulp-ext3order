// d.js

// @class D
// i.js

Ext.define('I', {
	override: 'D',

});
// c.js

C = Ext.extend(D, {});
// h.js

Ext.define('H', {
	extend: 'C',

});
// b.js

// @class B
// @extends C

// a.js

// #dependsFile mocks/b.js
// #dependsFile mocks/c.js

// e.js

// #dependsFile mocks/d.js
// #dependsFile mocks/a.js

// f.js

// g.js
