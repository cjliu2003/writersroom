"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneInvariantError = void 0;
class SceneInvariantError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'SceneInvariantError';
    }
}
exports.SceneInvariantError = SceneInvariantError;
//# sourceMappingURL=invariants.js.map