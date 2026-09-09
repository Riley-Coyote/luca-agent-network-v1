var LucaIdentity = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
	//#endregion
	//#region ../node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react.production.js
	/**
	* @license React
	* react.production.js
	*
	* Copyright (c) Meta Platforms, Inc. and affiliates.
	*
	* This source code is licensed under the MIT license found in the
	* LICENSE file in the root directory of this source tree.
	*/
	var require_react_production = /* @__PURE__ */ __commonJSMin(((exports) => {
		var ReactNoopUpdateQueue = {
			isMounted: function() {
				return !1;
			},
			enqueueForceUpdate: function() {},
			enqueueReplaceState: function() {},
			enqueueSetState: function() {}
		}, assign = Object.assign, emptyObject = {};
		function Component(props, context, updater) {
			this.props = props;
			this.context = context;
			this.refs = emptyObject;
			this.updater = updater || ReactNoopUpdateQueue;
		}
		Component.prototype.isReactComponent = {};
		Component.prototype.setState = function(partialState, callback) {
			if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
			this.updater.enqueueSetState(this, partialState, callback, "setState");
		};
		Component.prototype.forceUpdate = function(callback) {
			this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
		};
		function ComponentDummy() {}
		ComponentDummy.prototype = Component.prototype;
		function PureComponent(props, context, updater) {
			this.props = props;
			this.context = context;
			this.refs = emptyObject;
			this.updater = updater || ReactNoopUpdateQueue;
		}
		var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
		pureComponentPrototype.constructor = PureComponent;
		assign(pureComponentPrototype, Component.prototype);
		pureComponentPrototype.isPureReactComponent = !0;
		Array.isArray;
	}));
	(/* @__PURE__ */ __commonJSMin(((exports, module) => {
		module.exports = require_react_production();
	})))();
	/**
	* Canonical pubkey normalisation.
	*
	* Hex pubkeys are case-insensitive, but callers compare them with `===`.
	* Trimming guards against stray whitespace from user input or tag parsing.
	*/
	function normalizePubkey(pubkey) {
		return pubkey.trim().toLowerCase();
	}
	/**
	* The ONE canonical compact display form for a pubkey: `abcd1234…wxyz`.
	*
	* A truncated pubkey is a recognition aid, never an identity proof — vanity
	* grinders forge short prefixes cheaply. Surfaces where the user makes a
	* trust decision must show the full npub (see `<PubKey variant="full">`).
	* Do not hand-roll `pubkey.slice(…)` display forms; `check-pubkey-truncation`
	* fails the build if one sneaks in outside this module.
	*/
	function truncatePubkey(pubkey) {
		if (pubkey.length <= 12) return pubkey;
		return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
	}
	//#endregion
	//#region ../node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react-jsx-runtime.production.js
	/**
	* @license React
	* react-jsx-runtime.production.js
	*
	* Copyright (c) Meta Platforms, Inc. and affiliates.
	*
	* This source code is licensed under the MIT license found in the
	* LICENSE file in the root directory of this source tree.
	*/
	var require_react_jsx_runtime_production = /* @__PURE__ */ __commonJSMin(((exports) => {}));
	(/* @__PURE__ */ __commonJSMin(((exports, module) => {
		module.exports = require_react_jsx_runtime_production();
	})))();
	var GRID_SIZE = 7;
	var SOURCE_COLUMNS = 4;
	function keyBytes(publicKey) {
		const source = normalizePubkey(publicKey).replace(/[^a-f0-9]/g, "") || publicKey.toLowerCase();
		let seed = 2166136261;
		for (let index = 0; index < source.length; index += 1) {
			seed ^= source.charCodeAt(index);
			seed = Math.imul(seed, 16777619) >>> 0;
		}
		return Array.from({ length: GRID_SIZE * SOURCE_COLUMNS }, (_, index) => {
			seed ^= index + 2654435769;
			seed = Math.imul(seed ^ seed >>> 16, 569420461) >>> 0;
			seed = Math.imul(seed ^ seed >>> 15, 1935289751) >>> 0;
			return (seed ^ seed >>> 15) & 1;
		});
	}
	function agentIdentityMatrix(publicKey) {
		const bits = keyBytes(publicKey);
		return Array.from({ length: GRID_SIZE }, (_, row) => {
			const half = bits.slice(row * SOURCE_COLUMNS, row * SOURCE_COLUMNS + SOURCE_COLUMNS);
			return [...half, ...half.slice(0, GRID_SIZE - SOURCE_COLUMNS).reverse()].map(Boolean);
		});
	}
	function shortAgentFingerprint(publicKey) {
		return truncatePubkey(normalizePubkey(publicKey));
	}
	//#endregion
	exports.agentIdentityMatrix = agentIdentityMatrix;
	exports.shortAgentFingerprint = shortAgentFingerprint;
	return exports;
})({});
