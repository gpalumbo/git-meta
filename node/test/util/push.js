/*
 * Copyright (c) 2016, Two Sigma Open Source
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of git-meta nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

const co     = require("co");

const Push            = require("../../lib/util/push");
const RepoAST         = require("../../lib/util/repo_ast");
const RepoASTUtil     = require("../../lib/util/repo_ast_util");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");

/**
 * Return a map from name to RepoAST that is the same as the one in the
 * specified `expected`, but having transformed the name of each reference from
 * the form of `ref/commit/<logical commit id>` to
 * `ref/commit/<physical commit id>`, where <logical commit id> is the id of
 * the commit the ref points to.  The specified `mapping` argument contains a
 * `reverseCommitMap` object that maps from logical to physical commit id.
 *
 * @param {Object} expected
 * @param {Object} mapping (as in RepoASTTestUtil)
 * @return  {Object}
 */
function refMapper(expected, mapping) {
    const syntheticMetaRefRE = /(commits\/)(.*)/;
    const reverseCommitMap = mapping.reverseCommitMap;

    function mapASTRefs(ast) {
        let newRefs = {};
        const oldRefs = ast.refs;
        Object.keys(oldRefs).forEach(ref => {
            const logicalId = oldRefs[ref];
            const physicalId = reverseCommitMap[logicalId];
            const newRefName = ref.replace(syntheticMetaRefRE,
                                           `$1${physicalId}`);
            newRefs[newRefName] = logicalId;
        });
        return newRefs;
    }

    let result = {};
    Object.keys(expected).forEach(key => {
        const ast = expected[key];
        const newRefs = mapASTRefs(ast);
        const newSubs = refMapper(ast.openSubmodules, mapping);
        result[key] = ast.copy({
            openSubmodules: newSubs,
            refs: newRefs,
        });
    });
    return result;
}

describe("refMapper", function () {
    // Test the `refMapper` function used in this test driver.

    const Commit    = RepoAST.Commit;
    const Submodule = RepoAST.Submodule;
    const cases = {
        "trivial": {
            input: {
            },
            expected: {
            },
        },
        "simple": {
            input: {
                x: new RepoAST(),
            },
            expected: {
                x: new RepoAST(),
            },
        },
        "no transform": {
            input: {
                x: new RepoAST({
                    commits: { "1": new Commit() },
                    refs: {
                        "foo/bar": "1",
                    },
                }),
            },
            expected: {
                x: new RepoAST({
                    commits: { "1": new Commit() },
                    refs: {
                        "foo/bar": "1",
                    },
                }),
            },
        },
        "transform": {
            input: {
                x: new RepoAST({
                    commits: { "1": new Commit() },
                    refs: {
                        "commits/1": "1",
                    },
                }),
            },
            expected: {
                x: new RepoAST({
                    commits: { "1": new Commit() },
                    refs: {
                        "commits/ffff": "1",
                    },
                }),
            },
            reverseCommitMap: {
                "1": "ffff",
            },
        },
        "transform in sub": {
            input: {
                x: new RepoAST({
                    commits: { "2": new Commit() },
                    head: "2",
                    index: {
                        q: new Submodule("a","a"),
                    },
                    openSubmodules: {
                        q: new RepoAST({
                            commits: { "1": new Commit() },
                            refs: {
                                "commits/1": "1",
                            },
                        })
                    },
                }),
            },
            expected: {
                x: new RepoAST({
                    commits: { "2": new Commit() },
                    head: "2",
                    index: {
                        q: new Submodule("a","a"),
                    },
                    openSubmodules: {
                        q: new RepoAST({
                            commits: { "1": new Commit() },
                            refs: {
                                "commits/ffff": "1",
                            },
                        })
                    },
                }),
            },
            reverseCommitMap: {
                "1": "ffff",
            },
        },
    };

    Object.keys(cases).forEach(caseName => {
        const c = cases[caseName];
        it(caseName, () => {
            const result = refMapper(c.input, {
                reverseCommitMap: c.reverseCommitMap || {},
            });
            RepoASTUtil.assertEqualRepoMaps(result, c.expected);
        });
    });
});

describe("push", function () {

    function pusher(repoName, remoteName, source, target, force) {
        return co.wrap(function *(repos) {
            force = force || false;
            const x = repos[repoName];
            yield Push.push(x, remoteName, source, target, force);
        });
    }

    const cases = {
        "simple failure": {
            initial: "a=S",
            manipulator: pusher("a", "origin", "master", "master"),
            fails: true,
        },
        "no-ffwd failure": {
            initial: "a=B:C2-1;Bmaster=2|b=Ca:C3-1;Bmaster=3",
            manipulator: pusher("b", "origin", "master", "master"),
            fails: true,
        },
        "no-ffwd success": {
            initial: "a=B:C2-1;Bmaster=2|b=Ca:C3-1;Bmaster=3",
            manipulator: pusher("b", "origin", "master", "master", true),
            expected: "a=B:C3-1;Bmaster=3|b=Ca",
        },
        "simple (noop) success": {
            initial: "a=S|b=Ca",
            manipulator: pusher("b", "origin", "master", "master"),
        },
        "simple new branch success": {
            initial: "a=S|b=Ca",
            manipulator: pusher("b", "origin", "master", "foo"),
            expected: "a=E:Bfoo=1|b=E:Rorigin=a foo=1,master=1",
        },
        "simple success": {
            initial: "a=B|b=Ca:C2-1;Bmaster=2",
            manipulator: pusher("b", "origin", "master", "master"),
            expected: "a=E:C2-1;Bmaster=2|b=E:Rorigin=a master=2",
        },
        "closed submodule no change": {
            initial: "a=B|b=B|x=Ca:I b=Sb:1",
            manipulator: pusher("x", "origin", "master", "master"),
        },
        "open submodule no change": {
            initial: "a=B|b=B|x=Ca:I b=Sb:1;Ob Bmaster=1",
            manipulator: pusher("x", "origin", "master", "master"),
        },
        "open submodule make an unneeded ref": {
            initial: "a=B|b=B|x=Ca:C2-1 b=Sb:1;Bmaster=2;Ob",
            manipulator: pusher("x", "origin", "master", "foo"),
            expected: "\
a=E:Bfoo=2|\
b=E:Fcommits/1=1|\
x=E:Rorigin=a master=1,foo=2;Ob",
        },
        "open submodule push new ref": {
            initial: "a=B|b=B|x=Ca:C2-1 b=Sb:3;Bmaster=2;Ob C3-1",
            manipulator: pusher("x", "origin", "master", "foo"),
            expected: "\
a=E:Bfoo=2|\
b=E:Fcommits/3=3|\
x=E:Rorigin=a master=1,foo=2;Ob",
        },
        "open submodule derive URL from meta-repo, not local remote": {
            initial: "\
a=B|\
b=B|\
c=B|\
x=Ca:C2-1 b=Sb:3;Bmaster=2;Ob C3-1!Rorigin=c",
            manipulator: pusher("x", "origin", "master", "foo"),
            expected: "\
a=E:Bfoo=2|\
b=E:Fcommits/3=3|\
x=E:Rorigin=a master=1,foo=2;Ob Rorigin=c",
        },
        "open submodule meta remote is sub remote": {
            initial: `
a=B|
x=S:Rorigin=a;C2-1 b=S.:x;Bmaster=2;Ob Cx-1!H=x!Rorigin=a`,
            manipulator: pusher("x", "origin", "master", "foo"),
            expected: `
a=E:Bfoo=2;Fcommits/x=x|
x=E:Rorigin=a foo=2`,
        },
        "open submodule meta remote is sub remote, ignore origin": {
            initial: `
a=B|
b=B|
x=S:Rorigin=a;C2-1 b=S.:x;Bmaster=2;Ob Cx-1!H=x!Rorigin=b`,
            manipulator: pusher("x", "origin", "master", "foo"),
            expected: `
a=E:Bfoo=2;Fcommits/x=x|
x=E:Rorigin=a foo=2`,
        },
    };

    Object.keys(cases).forEach(caseName => {
        const c = cases[caseName];
        it(caseName, co.wrap(function *() {
            yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                           c.expected,
                                                           c.manipulator,
                                                           c.fails, {
                expectedTransformer: refMapper,
            });
        }));
    });
});
