#!/usr/bin/env bb
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; namespace and dependency bootstrap

(ns tasktron
  {:clj-kondo/config
   '{:lint-as {tasktron/asserting clojure.core/as->}}}
  (:refer-clojure :exclude [run!])
  (:require [babashka.deps :as deps]))

(deps/add-deps
 '{:deps {dev.weavejester/cljfmt     {:mvn/version "0.16.5"}
          metosin/malli              {:mvn/version "0.20.1"}
          nubank/matcher-combinators {:mvn/version "3.9.1"}
          org.clojure/core.match     {:mvn/version "1.1.0"}}})

(require '[babashka.fs :as fs]
         '[babashka.pods :as pods]
         '[babashka.process :as p]
         '[cheshire.core :as json]
         '[cljfmt.core :as cljfmt]
         '[clojure.core.match :refer [match]]
         '[clojure.edn :as edn]
         '[clojure.pprint :as pprint]
         '[clojure.string :as str]
         '[clojure.test :as t :refer [deftest is]]
         '[malli.core :as m]
         '[malli.error :as me]
         '[malli.json-schema :as mjs]
         '[malli.transform :as mt]
         '[matcher-combinators.matchers :as mc]
         '[matcher-combinators.test :refer [match?]])

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; configuration and execution policy

(def MAX-REVISIONS 3)
(def MAX-WORKTREES 3)
(def AGENT-TIMEOUT-MS (* 60 60 1000))
(def AGENT-ANSWER-ATTEMPTS 3)
(def CHECK-TIMEOUT-MS (* 15 60 1000))
(def PROGRESS-REFRESH-MS 1000)
(def PROCESS-EXIT-GRACE-MS 5000)
(def ^:dynamic *task-processes* nil)
(def COMMAND-NAME (fs/file-name *file*))
;; Prompts tell the agent to run COMMAND-PATH, which works from any directory,
;; and to name COMMAND-NAME in the text it shows the user.
(def COMMAND-PATH (str (fs/canonicalize *file*)))

(def TASKTRON-DIRECTORY ".tasktron")
(def WIP-DIRECTORY "wip")
(def WORKTREES-DIRECTORY "worktrees")
(def COMPLETED-DIRECTORY "completed")
(def TASK-FILENAME "task.md")
(def TEST-PLAN-FILENAME "test-plan.md")
(def STATE-FILENAME "state.edn")
(def RUN-LOCK-FILENAME ".run.lock")
(def AGENT-LOG-FILENAME "agent.log")
(def WIP-TASK-PATH
  (str TASKTRON-DIRECTORY "/" WIP-DIRECTORY "/" TASK-FILENAME))
(def WIP-TEST-PLAN-PATH
  (str TASKTRON-DIRECTORY "/" WIP-DIRECTORY "/" TEST-PLAN-FILENAME))
(def DRAFT-TEMPLATE-TITLE "Untitled task")
(def DRAFT-TEMPLATE
  (str "# " DRAFT-TEMPLATE-TITLE "\n\nDescribe the task here.\n"))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; prompts

(def REFINE-PROMPTS
  {:system (str "Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Explore the current project context and ask questions one at a time to refine the idea.
Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.
"
                "Once a shared understanding has been reached, write a summary in " WIP-TASK-PATH
                "
## The Process

**Understanding the idea:**
- Check out the current project state:
   - Where in codebase changes are needed for this task
   - What existing patterns/structures to follow
   - Which files need modification
   - What related features/code already exist
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- If you have a clear recommendation, state it with the question
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**
- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## The written document

The document's body is later included verbatim in every subtask agent's prompt during implementation, so it must hold only context that applies to the whole task.

Structure the body as: intent (what and why), background, design decisions with rationale, constraints and invariants, acceptance criteria, out of scope, and open questions.
Skip a section when the task has nothing to say under it.

Do not write ordered implementation steps, a work breakdown, or step-by-step sections — decomposing the task into subtasks is the `" COMMAND-NAME " plan` command's job.
Record **decisions**, not **sequencing**.

## Manual test plan

After the summary in " WIP-TASK-PATH " is agreed, also draft " WIP-TEST-PLAN-PATH " capturing what the user should verify — core end-to-end scenarios derived from the acceptance criteria.
Structure it as: title `# Manual test plan: <task title>`, then `## Core tests` — a few end-to-end checks of the main functionality that alone give confidence — then `## Detailed tests (optional)` for edge cases and thorough per-feature verification.
Each test states setup (if any), concrete steps or commands, and the expected observable result — written for a human at a shell or UI, never \"verify it works\".
Steps assume a checkout of the task branch and use paths relative to the repository root.
Create the file only when the task has user-verifiable behavior; pure refactors and internal cleanups get none.
The test plan is written for the user, not for agents — anything an agent needs must live in the task body instead.

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense

## Next step

When the user is satisfied with the summary in " WIP-TASK-PATH ", tell them to run `" COMMAND-NAME " plan` to decompose it into subtasks.")

   :prompt (str "Refine " WIP-TASK-PATH " with the user; its current contents are below.")})

(def PLAN-PROMPTS
  {:system (str "Work with the user to restructure " WIP-TASK-PATH " around a ## Subtasks section.

The task body (everything above ## Subtasks) is included verbatim in every subtask agent's prompt, so duplicated material is paid for once per subtask, and a body that disagrees with the plan hands the implementation agent conflicting instructions.
Move all implementation steps and ordered work from the body into subtasks, then delete them from the body.
After planning, the body holds only context shared by every subtask, and the subtasks are the sole statement of what to do and in what order.
Where a subtask deviates from something the body says, fix the body rather than annotating the discrepancy in the subtask.

Each subtask needs a `### title` followed by optional frontmatter and then a non-empty body.
Frontmatter is a run of `key: value` lines directly under a heading, terminated by a blank line; without that blank line the run is body text.
Subtask frontmatter keys, each repeatable:

- `dependencies:` — space-separated subtask slug ids
- `check:` — one shell command (run with `sh -c` in the subtask's worktree) that must exit 0 for the subtask to pass

The document title `# <title>` also accepts `check:` frontmatter; those task-level checks run for **every** subtask, and a subtask's own `check:` lines run after them as extras.
Every check must be deterministic in a fresh worktree (typically the test or lint runner); prefer one task-level check over repeating the same command per subtask.
A check may invoke a helper script that a subtask creates, but only where it exists when the check runs: task-level checks can rely only on what is already at the repository tip, and a subtask check can rely on helpers from subtasks in its `dependencies:` chain.

A subtask's slug id is derived from its title: lower-cased, split on spaces, with every remaining non-alphanumeric character deleted.
So `### Configure src/db.clj` becomes `configure-srcdbclj`, not `configure-src-db-clj`.
Never write a `dependencies:` id by hand without applying that rule to the title you are pointing at.

For example:

```markdown
# Add feature

check: bb test.clj

Let's add a cool feature to our app.

## Subtasks

### Lay the groundwork in db.clj

First we have to do X.

### Build feature

dependencies: lay-the-groundwork-in-dbclj
check: bb test.clj --only feature-test

Now we can build Y.
```

Write a detailed implementation plan for the current task, split into small, concrete, independently-executable subtasks.

**YAGNI:**

- Prefer the minimum required change to satisfy the task
- Choose the simplest solution that satisfies the requirements
- If something can be simplified further, do so
- Clarify whether adversarial inputs and rare situations are in scope, or if the use case is primarily on the happy path

## Subtasks

A **subtask** is **one independently-deliverable, coherent review unit** (something that could be implemented and reviewed on its own).
It may depend on earlier completed subtasks, and may include multiple steps (e.g. test → implement → verify), but it must be specific and actionable.

Avoid “investigation-only” subtasks. If you must investigate, it should be a small, time-boxed first step inside a subtask that still ends with a concrete code/config change.

## Remember

- Use file paths relative to the repository root, e.g. `src/foo.clj` (no “or wherever this lives”); never absolute paths — subtasks execute in temporary git worktrees at a different filesystem location, so absolute paths resolve to the wrong checkout
- Use explicit commands (with expected outcomes) instead of “run tests”
- Keep subtasks DRY and YAGNI
- Prefer concrete edits over vague language (avoid “add validation”, “refactor stuff”)
- Minimize subtask `dependencies:` so they can run in parallel
- Prefer specifying subtask tests with `check:` rather than in their description

## Manual test plan

While decomposing, concretize the manual test plan in " WIP-TEST-PLAN-PATH ": real commands, real paths, expected output.
Create or delete that file if planning changes whether user-verifiable, testable surface exists; pure refactors and internal cleanups get none.
The test plan is written for the user, not for agents — anything an agent needs must live in the task body instead.

## Validate

After you write or change the ## Subtasks section, run:

    " COMMAND-PATH " validate

Run it by that absolute path; the script is not on `PATH`.
When you name a Tasktron command in text you show the user, write `" COMMAND-NAME "` instead of the path.
Fix every reported error and re-run until it prints `Valid: N subtasks.`
A dangling `dependencies:` id is invisible on reading and blocks `" COMMAND-NAME " approve`, so do not tell the user the plan is ready before it validates.

## Next step

When the user is satisfied with the ## Subtasks section, tell them to run `" COMMAND-NAME " review-plan` to review the plan.
")

   :prompt (str "Work with the user to restructure " WIP-TASK-PATH " around a ## Subtasks section; its current contents are below.")})

(def REVIEW-PLAN-PROMPTS
  {:system (str "Review the **implementation plan** in " WIP-TASK-PATH " with the user.

**Your task:**

1. Read the task document’s problem description/requirements.
2. Review the proposed `## Subtasks` section.
3. Check that the plan is minimal (YAGNI), concrete, testable, and complete.
4. Identify important risks/gaps (architecture, testing, migrations, security, ops, and manual verification).
5. If there are no important, concrete, actionable issues, recommend to the user to run `" COMMAND-NAME " approve`.


## Task document editing rules (critical)

- Do not update the root task document immediately when you find plan problems.
- First, present the findings as a short actionable list and wait for the user's decision.
- If the user approves, edit the document.

## Review Checklist

**Plan Quality:**

- The document parses: run `" COMMAND-PATH " validate` and confirm it prints `Valid: N subtasks.` Report any error it prints as a finding, quoting it
- The body (above ## Subtasks) holds only context shared by every subtask — no step-by-step work that duplicates subtasks, and nothing the subtasks contradict (the body is included in every subtask agent's prompt)
- Subtasks are independently deliverable (each could be implemented/reviewed on its own)
- Each subtask is concrete and actionable (not “investigate”, not vague refactors)
- File paths are exact and relative to the repository root (no “wherever this lives”, no absolute paths — subtasks execute in temporary git worktrees where absolute paths resolve to the wrong checkout)
- Commands are explicit and include expected outcomes (not “run tests”)
- Ordering makes sense (dependencies between subtasks are explicit)
- `check:` commands (task-level and per-subtask) are deterministic and exit 0 in a fresh worktree when the work is correct; anything a check invokes exists when it runs (already at the tip for task-level checks, or created by a dependency subtask for per-subtask checks)
- Subtask `dependencies:` obviously necessary; if it's unclear why one subtask should or should not depend on another, ask for clarification
- Subtask tests are specified with `check:` rather than in their description


**YAGNI:**

- Minimum required change to satisfy the task
- Simplest viable approach (no speculative abstractions)
- No scope creep / extra features

**Architecture / Design:**

- Changes fit existing code structure and conventions
- Separation of concerns is preserved (no tangled responsibilities)
- Error handling and edge cases are accounted for where relevant
- Performance and security implications are considered when applicable

**Requirements / Compatibility:**

- Every requirement from the task is covered by at least one subtask
- Proposed plan matches the spec (no missing acceptance criteria)
- Documentation updates are included when needed
- When " WIP-TEST-PLAN-PATH " exists, its core tests cover the acceptance criteria, its steps are concrete and human-runnable on the task branch, and nothing in it contradicts the task body; when it is absent, the omission is justified (no user-verifiable behavior). The test plan is written for the user, not for agents — anything an agent needs must live in the task body instead. Report test-plan findings before editing, as with other findings

### Findings format (when needed)

For each finding:

- Reference the exact subtask by **title** (and quote the relevant lines if helpful)
- Explain **why** it matters
- Specify exactly **what to change** in the plan

If the user approves incorporating your findings, update the plan accordingly. Until then, only report the findings.

## Critical Rules

- Be specific (reference subtask titles / quoted text; avoid vague advice).
- Explain why each issue matters.
- No nitpicks or bike shedding.

## Next step

Before recommending approval, run `" COMMAND-PATH " validate` and confirm it prints `Valid: N subtasks.`
Run it by that absolute path; the script is not on `PATH`.
When you name a Tasktron command in text you show the user, write `" COMMAND-NAME "` instead of the path.
When the plan validates and needs no further changes, tell the user to run `" COMMAND-NAME " approve` to start the run.")

   :prompt (str "Review the implementation plan in " WIP-TASK-PATH " with the user; its current contents are below.")})

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; schema utilities

(def schema->assert! (memoize m/coercer))

(defn assert-schema! [schema value]
  ((schema->assert! schema) value))

(defn exception-chain [exception]
  (take-while some? (iterate ex-cause exception)))

(defn pretty-str [value]
  (str/trimr (with-out-str (pprint/pprint value))))

(defn render-error [exception]
  (if-let [explanation (some #(get-in (ex-data %) [:data :explain])
                             (exception-chain exception))]
    (str "Schema validation failed.\n\n"
         "Value:\n" (pretty-str (:value explanation)) "\n\n"
         "Problems:\n" (pretty-str (me/humanize explanation)))
    (let [cause (last (exception-chain exception))]
      (or (ex-message cause) (str cause)))))

(defn tagged-union [dispatch-key variant->schema]
  (into [:multi {:dispatch dispatch-key}] variant->schema))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; version control protocol

(defprotocol IVcs
  (task-tip [vcs task-id]
    "The current commit for a task, or nil when the task does not exist.")
  (create-task! [vcs task-id]
    "Create a task at the current checkout tip and return that commit.")
  (task-target [vcs task-id]
    "A human-readable name for the task's VCS target.")
  (prepare-worktree! [vcs commit dir]
    "Ensure a detached worktree at commit and return its directory.")
  (remove-worktree! [vcs dir]
    "Unregister and remove a temporary worktree.")
  (apply-commit! [vcs dir commit]
    "Apply a commit without committing; return :applied or :conflict.")
  (commit-worktree! [vcs dir base message]
    "Collapse the worktree delta against base with message {:subject :body :author :committer}; return nil for an empty delta.")
  (show-commit [vcs commit]
    "Render a commit for review. A long rendering may be simplified, e.g. a large diff may become a stat summary plus instructions for retrieving each file's changes.")
  (advance-task! [vcs task-id expected new-tip]
    "Compare-and-swap a task tip, returning :advanced or :stale."))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; task domain model

(def TaskId :keyword)
(def SubtaskId :keyword)
(def CommitId [:string {:min 6}])
(def Timestamp [:fn inst?])

(def ShellCommand [:string {:min 1}])

(def SubtaskSpec
  [:map
   [:id SubtaskId]
   [:title :string]
   [:body :string]
   [:dependencies [:vector SubtaskId]]
   [:checks [:vector ShellCommand]]])

(def TaskSpec
  [:map
   [:title :string]
   [:body :string]
   [:checks [:vector ShellCommand]]
   [:subtasks [:vector SubtaskSpec]]])

(def Feedback
  [:map
   [:title :string]
   [:body :string]])

(def ImplementationAnswer
  [:map
   [:outcome [:enum :done :blocked]]
   [:summary :string]])

(def ReviewAnswer
  [:or
   [:map
    [:outcome [:= :approved]]
    [:summary :string]]
   [:map
    [:outcome [:= :amended]]
    [:summary :string]]
   [:map
    [:outcome [:= :revision-requested]]
    [:feedback [:vector Feedback]]]])

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; agent execution

(def role->agent

  {:authoring
   ;;{:harness :claude-code :model "claude-fable-5" :thinking :high :name "Fable 5"}
   {:harness :pi :model "openai-codex/gpt-5.6-sol" :thinking :high :name "gpt-5.6-sol"}

   :implementation      {:harness :claude-code :model "claude-opus-4-8" :thinking :high :name "Opus 4.8"}
   :review              {:harness :claude-code :model "claude-opus-4-8" :thinking :high :name "Opus 4.8"}
   :conflict-resolution {:harness :claude-code :model "claude-opus-4-8" :thinking :high :name "Opus 4.8"}})

(def AgentHarness [:enum :claude-code :pi])
(def AgentRole (into [:enum] (keys role->agent)))
(def SessionId [:string {:min 6}])

(def AgentConfig
  [:map
   [:harness AgentHarness]
   [:model :string]
   [:thinking [:enum :low :medium :high :xhigh :max]]
   [:name :string]])

(def AgentCommandOptions
  [:multi {:dispatch :mode}
   [:interactive
    [:map
     [:prompt {:optional true} [:maybe :string]]
     [:system {:optional true} :string]]]
   [:headless
    [:map
     [:system {:optional true} :string]
     [:session-id SessionId]
     [:resume? {:optional true} :boolean]]]])

(def AgentMetadata
  [:map
   [:harness AgentHarness]
   [:session-id SessionId]
   [:name :string]])

(def CommitContext
  [:map
   [:subject :string]
   [:author {:optional true} :string]
   [:summary {:optional true} :string]
   [:notes [:vector :string]]
   [:sessions [:map-of AgentRole :string]]])

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; workflow events

(def subtask-event->schema
  {:specified               [:map [:body :string]]
   :reset                   :map
   :implementation-started  [:map [:base CommitId]]
   :implementation-finished [:map [:commit CommitId] [:summary :string] [:agent AgentMetadata]] ;;TOD: should agent metadata be on impl started too?
   :check-passed            :map
   :check-failed            [:map [:command :string] [:exit :int] [:output :string]]
   :approved                [:map [:commit CommitId] [:summary :string] [:agent AgentMetadata]]
   :amended                 [:map [:commit CommitId] [:summary :string] [:agent AgentMetadata]]
   :feedback                [:map
                             [:feedback [:vector Feedback]]
                             [:agent AgentMetadata]]
   :revision-finished       [:map [:commit CommitId] [:summary :string] [:agent AgentMetadata]]
   :rebase-started          [:map [:base CommitId] [:source CommitId]]
   :rebase-conflicted       [:map [:output :string]]
   :rebase-finished         [:map [:commit CommitId]
                             [:note {:optional true} :string]
                             [:agent {:optional true} AgentMetadata]]
   :branch-advanced         [:map [:commit CommitId]]
   :blocked                 [:map [:summary :string]]})

(def SubtaskEvent
  (tagged-union :event-name subtask-event->schema))

(def DurableSubtaskEvent
  [:and SubtaskEvent [:map [:at Timestamp]]])

(def control-event->schema
  {:run-requested   :map
   :retry-requested [:map [:subtask {:optional true} SubtaskId]]})

(def ControlEvent
  (tagged-union :event-name control-event->schema))

(def operational-event->schema
  {:effect-failed [:map [:summary :string]]
   :branch-stale  [:map
                   [:expected CommitId]
                   [:actual CommitId]]})

(def Event
  (tagged-union :event-name (merge subtask-event->schema
                                   control-event->schema
                                   operational-event->schema)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; workflow stages and effects

(def stage->definition
  {:initial               {:schema      :map
                           :transitions {:specified :pending}}
   :pending               {:schema      :map
                           :transitions {:implementation-started :implementing}}
   :implementing          {:schema      [:map [:base CommitId]]
                           :transitions {:implementation-finished :checking
                                         :blocked                 :blocked}}
   :checking              {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:check-passed :reviewing
                                         :check-failed :revising
                                         :blocked      :blocked}}
   :reviewing             {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:feedback :revising
                                         :amended  :checking-amendment
                                         :approved :awaiting-integration
                                         :blocked  :blocked}}
   :checking-amendment    {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:check-passed :awaiting-integration
                                         :check-failed :revising
                                         :blocked      :blocked}}
   :revising              {:schema      [:map
                                         [:base CommitId]
                                         [:commit CommitId]]
                           :transitions {:revision-finished :checking
                                         :blocked           :blocked}}
   :awaiting-integration  {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:rebase-started  :rebasing
                                         :branch-advanced :integrated
                                         :blocked         :blocked}}
   :rebasing              {:schema      [:map [:base CommitId] [:source CommitId]]
                           :transitions {:rebase-conflicted :resolving-integration
                                         :rebase-finished   :checking-integration
                                         :blocked           :blocked}}
   :resolving-integration {:schema      [:map
                                         [:base CommitId]
                                         [:source CommitId]
                                         [:output :string]]
                           :transitions {:rebase-finished :checking-integration
                                         :blocked         :blocked}}
   :checking-integration  {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:check-passed :ready-to-advance
                                         :check-failed :revising-integration
                                         :blocked      :blocked}}
   :revising-integration  {:schema      [:map
                                         [:base CommitId]
                                         [:commit CommitId]]
                           :transitions {:revision-finished :checking-integration
                                         :blocked           :blocked}}
   :ready-to-advance      {:schema      [:map [:base CommitId] [:commit CommitId]]
                           :transitions {:branch-advanced :integrated
                                         :blocked         :blocked}}
   :blocked               {:schema      [:map [:summary :string]]
                           :transitions {:reset :pending}}
   :integrated            {:schema      :map
                           :transitions {}}})

(def Stage
  (tagged-union :stage-name (update-vals stage->definition :schema)))

(def StageName
  (into [:enum] (keys stage->definition)))

(def effect->definition
  ;; TODO: is it worth it to write out the expected :results for each effect so that I can check at runtime?
  {:implement      {:schema  [:map
                              [:subtask SubtaskId]
                              [:base CommitId]
                              [:instructions :string]
                              [:commit-context CommitContext]]
                    :results #{:implementation-finished :blocked}}
   :revise         {:schema  [:map
                              [:subtask SubtaskId]
                              [:base CommitId]
                              [:previous CommitId]
                              [:instructions :string]
                              [:commit-context CommitContext]]
                    :results #{:revision-finished :blocked}}
   :check          {:schema  [:map
                              [:subtask SubtaskId]
                              [:commit CommitId]
                              [:checks [:vector ShellCommand]]]
                    :results #{:check-passed :check-failed}}
   :review         {:schema  [:map
                              [:subtask SubtaskId]
                              [:base CommitId]
                              [:commit CommitId]
                              [:instructions :string]
                              [:commit-context CommitContext]]
                    :results #{:approved :amended :feedback}}
   :attempt-rebase {:schema  [:map
                              [:subtask SubtaskId]
                              [:base CommitId]
                              [:source CommitId]
                              [:commit-context CommitContext]]
                    :results #{:rebase-finished :rebase-conflicted}}
   :resolve-rebase {:schema  [:map
                              [:subtask SubtaskId]
                              [:base CommitId]
                              [:source CommitId]
                              [:output :string]
                              [:instructions :string]
                              [:commit-context CommitContext]]
                    :results #{:rebase-finished :blocked}}
   :advance-branch {:schema  [:map
                              [:subtask SubtaskId]
                              [:expected CommitId]
                              [:new-tip CommitId]]
                    :results #{:branch-advanced :branch-stale}}})

(def effect-result-event-names
  (into #{:effect-failed}
        (mapcat :results) (vals effect->definition)))

(def Effect
  (tagged-union :effect-name (update-vals effect->definition :schema)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; durable state and runtime contexts

(def SubtaskState
  [:map
   [:history [:vector DurableSubtaskEvent]]])

(def State
  [:map
   [:task-id TaskId]
   [:task TaskSpec]
   [:tip CommitId]
   [:run-started-at {:optional true} Timestamp]
   [:subtasks [:map-of SubtaskId SubtaskState]]])

(def Runtime
  [:map
   [:repo-root :string]
   [:tasktron-root :string]
   [:vcs some?
    ;; TODO: actually check this
    ;;[:fn (partial satisfies? IVcs)]
    ]])

(def TaskRuntime
  [:and Runtime
   [:map
    [:task-id TaskId]
    [:task-dir :string]]])

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; forward declarations

(declare new-cmd refine-cmd plan-cmd review-plan-cmd approve-cmd run-cmd
         retry-cmd status-cmd validate-cmd self-test-cmd usage die!
         dispatch-command! command-named observed-draft next-authoring-command
         make-runtime task-runtime tasktron-path worktree-dir
         wip-dir wip-md agent-log-file exec-agent! invoke-agent!
         now initial-state read-state! save! parse-task task-errors slugify
         live-task-dirs resolve-task-dir resolve-subtask-id
         acquire-task-lock! task-running?
         author! run! run-and-finalize! archive-task! perform! reconcile-task
         complete? run-lock-file
         step outcome test-plan-note schedule-transition effects-for-state effect-for-stage
         render-task-overview make-progress-reporter
         build-implementation-instructions build-review-instructions
         build-rebase-resolution-instructions subtask-by-id subtask-stage subtask-status
         active-stages revision-trigger-count
         perform-implementation! perform-check! perform-review!
         perform-attempt-rebase! perform-resolve-rebase! perform-advance!
         prepare-effect-worktree! run-process-with-timeout! effect-failure-event
         terminate-processes! format-clj)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; application entry point

(defn -main
  [& args]
  (try
    (if-let [command-name (first args)]
      (dispatch-command! command-name (vec (rest args)))
      (let [runtime                  (make-runtime)
            {:keys [command reason]} (next-authoring-command
                                      (observed-draft runtime))]
        (println (str reason "; running `" COMMAND-NAME " " command "`."))
        ((command-named command) runtime [])))
    (catch clojure.lang.ExceptionInfo e
      (binding [*out* *err*]
        (println (render-error e)))
      (System/exit 1))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; authoring workflow

(defn observed-draft
  "The parsed WIP draft, :unparseable when parsing fails, or nil when absent."
  [runtime]
  (let [md-file (wip-md runtime)]
    (when (fs/exists? md-file)
      (try
        (parse-task (slurp (str md-file)))
        (catch Exception _ :unparseable)))))

(defn next-authoring-command
  "The authoring command that moves the observed draft toward approval."
  [draft]
  (cond
    (nil? draft)                            {:command "new"
                                             :reason  "No draft exists"}
    (= :unparseable draft)                  {:command "refine"
                                             :reason  "Draft does not parse"}
    (= DRAFT-TEMPLATE-TITLE (:title draft)) {:command "refine"
                                             :reason  "Draft empty"}
    (empty? (:subtasks draft))              {:command "plan"
                                             :reason  "Draft has no subtasks"}
    :else                                   {:command "review-plan"
                                             :reason  "Draft has subtasks"}))

(defn ^{:command   "new"
        :arguments []
        :doc       "create a draft and begin refining it"}
  new-cmd
  [runtime _args]
  (let [dir (wip-dir runtime)]
    (when (fs/exists? dir)
      (die! (str "A draft already exists; run `" COMMAND-NAME " refine`.")))
    (fs/create-dirs dir)
    (spit (str (wip-md runtime)) DRAFT-TEMPLATE)
    (author! runtime REFINE-PROMPTS)))

(defn ^{:command   "refine"
        :arguments []
        :doc       "continue refining the draft"}
  refine-cmd
  [runtime _args]
  (author! runtime REFINE-PROMPTS))

(defn ^{:command   "plan"
        :arguments []
        :doc       "decompose the draft into subtasks"}
  plan-cmd
  [runtime _args]
  (author! runtime PLAN-PROMPTS))

(defn ^{:command   "review-plan"
        :arguments []
        :doc       "review and improve the decomposition"}
  review-plan-cmd
  [runtime _args]
  (author! runtime REVIEW-PLAN-PROMPTS))

(defn authoring-prompt
  "Nil on an untouched template so the session waits for the user's first message."
  [prompt contents]
  (when (not= DRAFT-TEMPLATE contents)
    (str prompt "\n\nCurrent contents of " WIP-TASK-PATH ":\n\n" contents)))

(defn author!
  [{:keys [repo-root] :as runtime}
   {:keys [system prompt] :as _prompts}]
  (let [md-file (wip-md runtime)]
    (when-not (fs/exists? md-file)
      (die! (str "No draft exists; run `" COMMAND-NAME " new`.")))
    (let [contents (slurp (str md-file))]
      (exec-agent! repo-root system (authoring-prompt prompt contents) (role->agent :authoring)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; plan approval

(defn ^{:command   "approve"
        :arguments []
        :doc       "approve the draft and start its run"}
  approve-cmd
  [{:keys [vcs] :as runtime} _args]

  (let [md (wip-md runtime)]
    (when-not (fs/exists? md)
      (die! (str "No draft exists; run `" COMMAND-NAME " new`.")))

    (let [{:keys [title] :as task} (parse-task (slurp (str md)))
          task-id-str              (slugify title)
          task-id                  (keyword task-id-str)
          dir                      (tasktron-path runtime task-id-str)
          errors                   (concat (task-errors task)
                                           (when (or (fs/exists? dir) (task-tip vcs task-id))
                                             [(str "Task id `" task-id-str "` is already in use.")]))]

      (when (seq errors)
        (apply die! errors))

      (let [tip   (create-task! vcs task-id)
            state (initial-state task-id task tip (now))]

        (fs/move (wip-dir runtime) dir)
        (save! (str dir) state)
        (println (str "Approved " task-id-str " on " (task-target vcs task-id) "."))

        (let [{final :state final-dir :task-dir}
              (run-and-finalize! runtime dir state {:event-name :run-requested})]
          (println (str "Run " (name (outcome final)) "."))
          (when-let [note (test-plan-note final-dir (outcome final))]
            (println note)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; task workflow

(defn ^{:command   "run"
        :arguments [{:name "task" :optional true}]
        :doc       "continue an approved task"}
  run-cmd
  [runtime args]
  (let [dir   (resolve-task-dir runtime (first args)) ;;TODO: validate task-id
        state (read-state! (str dir))
        {final :state final-dir :task-dir}
        (run-and-finalize! runtime dir state {:event-name :run-requested})]
    (println (str (name (:task-id final)) ": " (name (outcome final))))
    (when-let [note (test-plan-note final-dir (outcome final))]
      (println note))
    final))

(defn ^{:command   "retry"
        :arguments [{:name "task" :optional true}
                    {:name "subtask" :optional true}]
        :doc       "retry one or all blocked subtasks"}
  retry-cmd
  [runtime args]
  (let [[task-name subtask-name] (case (count args)
                                   0 [nil nil]
                                   1 [nil (first args)]
                                   [(first args) (second args)])
        dir                      (resolve-task-dir runtime task-name)
        state                    (read-state! (str dir))
        event                    (cond-> {:event-name :retry-requested}
                                   subtask-name
                                   (assoc :subtask
                                          (resolve-subtask-id state subtask-name)))
        {final :state final-dir :task-dir}
        (run-and-finalize! runtime dir state event)]
    (println (str (name (:task-id final)) ": " (name (outcome final))))
    (when-let [note (test-plan-note final-dir (outcome final))]
      (println note))
    final))

(defn submit-effect! [executor completed worktrees runtime
                      {:keys [subtask] :as effect}]
  (.submit executor
           (bound-fn []
             (let [worktree (.take worktrees)]
               (try
                 (.add completed
                       {:subtask subtask
                        :event   (try
                                   (perform! runtime worktree effect)
                                   (catch Exception error
                                     (effect-failure-event error)))})
                 (finally
                   (.add worktrees worktree)))))))

(defn shutdown-executor! [executor processes]
  (.shutdownNow executor)
  (terminate-processes! processes)
  (try
    (.awaitTermination executor 5 java.util.concurrent.TimeUnit/SECONDS)
    (catch InterruptedException _
      (.interrupt (Thread/currentThread))))
  (terminate-processes! processes))

(defn interactive-terminal? []
  (and (some? (System/console))
       (not= "dumb" (System/getenv "TERM"))))

(defn make-progress-reporter [interactive? task-dir]
  (let [previous    (atom nil)
        drawn-lines (atom 0)]
    (fn [state at]
      (let [frame (render-task-overview state task-dir true at)]
        (if interactive?
          (do
            (when (pos? @drawn-lines)
              (print (str "\u001b[" @drawn-lines "A\u001b[J")))
            (println frame)
            (reset! drawn-lines (count (str/split-lines frame))))
          (if-let [before @previous]
            (doseq [{:keys [id title]} (get-in state [:task :subtasks])
                    :when              (not= (:stage-name (subtask-stage before id))
                                             (:stage-name (subtask-stage state id)))]
              (println (str "[" (name id) "] " title ": "
                            (subtask-status state id true))))
            (println frame)))
        (flush)
        (reset! previous state)))))

(defn await-completion! [completed interactive? report! state]
  (if-not interactive?
    (.take completed)
    (loop []
      (if-let [completion (.poll completed PROGRESS-REFRESH-MS
                                 java.util.concurrent.TimeUnit/MILLISECONDS)]
        completion
        (do (report! state (now))
            (recur))))))

(defn run!
  "Main loop that advances subtasks by running effects across MAX-WORKTREES concurrent threads/worktrees.
Exits when no more progress can be made."
  [{runtime-task-id :task-id :keys [task-dir] :as runtime}
   {state-task-id :task-id :as initial-state}
   initial-event]

  (assert-schema! TaskRuntime runtime)
  (when-not (= runtime-task-id state-task-id)
    (throw (ex-info "TaskRuntime does not match State"
                    {:runtime-task-id runtime-task-id
                     :state-task-id   state-task-id})))

  (with-open [_task-lock (acquire-task-lock! task-dir)]
    (let [initial-state (assoc initial-state :run-started-at (now))
          executor      (java.util.concurrent.Executors/newFixedThreadPool MAX-WORKTREES)
          ;; Create worktrees serially up front; concurrent first-time worktree adds race over the shared .git/config.
          worktrees     (java.util.concurrent.LinkedBlockingQueue.
                         (mapv #(prepare-worktree! (:vcs runtime)
                                                   (:tip initial-state)
                                                   (worktree-dir runtime %))
                               (range MAX-WORKTREES)))
          completed     (java.util.concurrent.LinkedBlockingQueue.)
          interactive?  (interactive-terminal?)
          report!       (make-progress-reporter interactive? task-dir)
          processes     (atom #{})
          shutdown-hook (Thread. #(terminate-processes! processes)
                                 "tasktron-process-cleanup")]
      (try
        (.addShutdownHook (Runtime/getRuntime) shutdown-hook)
        (binding [*task-processes* processes]
          (loop [state                   initial-state
                 subtask                 nil
                 event                   initial-event
                 subtask->running-effect {}]
            (let [observed-task   (parse-task (slurp (str (fs/path task-dir TASK-FILENAME))))
                  state           (reconcile-task state observed-task)
                  next-state      (step state subtask event (now))
                  effects-desired (effects-for-state next-state)
                ;; TODO: prioritize these to avoid expensive racing
                  effects-pending (remove (fn [{:keys [subtask]}]
                                            (contains? subtask->running-effect subtask))
                                          effects-desired)]

            ;; Write state before running effects so re-running recovers from crashes.
              (save! task-dir next-state)
              (report! next-state (now))

              (let [subtask->running-effect
                    (reduce (fn [active {:keys [subtask] :as effect}]
                              (submit-effect! executor completed worktrees runtime effect)
                              (assoc active subtask effect))
                            subtask->running-effect
                            effects-pending)]
                (if (seq subtask->running-effect)
                  (let [{:keys [subtask event]} (await-completion! completed interactive?
                                                                   report! next-state)]
                    (recur next-state
                           subtask
                           event
                           (dissoc subtask->running-effect subtask)))
                  next-state)))))
        (finally
          (shutdown-executor! executor processes)
          (try
            (.removeShutdownHook (Runtime/getRuntime) shutdown-hook)
            (catch IllegalStateException _)))))))

(defn archive-task!
  "Discard a completed task's transient run data and move what remains to .tasktron/completed/<task-id>/, returning that destination."
  [{:keys [vcs] :as runtime} task-dir]
  (let [task-id-str (fs/file-name task-dir)
        destination (tasktron-path runtime COMPLETED-DIRECTORY task-id-str)
        worktrees   (fs/path task-dir WORKTREES-DIRECTORY)]
    (when (fs/exists? destination)
      (die! (str "Task `" task-id-str "` is already archived at " destination ".")))
    (when (fs/directory? worktrees)
      ;; A previous attempt may already have removed some worktrees, so remove
      ;; only the children that are still there.
      (doseq [worktree (sort-by fs/file-name (fs/list-dir worktrees))]
        (remove-worktree! vcs (str worktree)))
      (fs/delete-tree worktrees))
    (fs/delete-if-exists (run-lock-file task-dir))
    (fs/create-dirs (fs/parent destination))
    (fs/move task-dir destination {:atomic-move true})
    destination))

(defn run-and-finalize!
  "Advance a task until it stops, then archive it once every subtask has integrated.
Return the final state and the directory that holds the task afterwards."
  [runtime task-dir state event]
  (let [final (run! (task-runtime runtime task-dir state) state event)]
    {:state    final
     :task-dir (str (if (complete? final)
                      (archive-task! runtime task-dir)
                      task-dir))}))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; inspection and validation commands

(defn ^{:command   "status"
        :arguments []
        :doc       "show every approved task"}
  status-cmd
  [runtime _args]
  (let [dirs (live-task-dirs runtime)]
    (if (seq dirs)
      (println
       (str/join "\n\n"
                 (for [dir dirs]
                   (render-task-overview (read-state! (str dir))
                                         (str dir)
                                         (task-running? dir)
                                         (now)))))
      (println "No approved tasks."))))

(defn ^{:command   "validate"
        :arguments []
        :doc       "validate task syntax and dependencies"}
  validate-cmd
  [{:keys [repo-root] :as runtime} _args]
  (let [paths [(wip-md runtime)
               (fs/path repo-root TASK-FILENAME)]
        file  (first (filter fs/exists? paths))]
    (when-not file (die! (str "No " TASK-FILENAME " found.")))
    (let [{:keys [subtasks] :as task} (parse-task (slurp (str file)))
          errors                      (task-errors task)]
      (if (seq errors) (apply die! errors)
          (println (str "Valid: " (count subtasks) " subtasks."))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; state reconstruction and transitions

(defn now [] (java.util.Date.))

(defn initial-state
  ([task-id task tip]
   (initial-state task-id task tip (now)))
  ([task-id {:keys [subtasks] :as task} tip at]
   {:task-id  task-id
    :task     task
    :tip      tip
    :subtasks (into {}
                    (map (fn [{:keys [id body]}]
                           [id {:history [{:event-name :specified :body body :at at}]}])
                         subtasks))}))

(defn history
  [state subtask-id]
  (get-in state [:subtasks subtask-id :history]))

(defn effective-history
  "History with each :blocked event annulled by the :reset that follows it, so a retried subtask resumes the stage the block interrupted."
  [events]
  (reduce (fn [kept {:keys [event-name] :as event}]
            (if (and (= :reset event-name)
                     (= :blocked (:event-name (peek kept))))
              (pop kept)
              (conj kept event)))
          []
          events))

(defn transition-stage
  "Apply one legal event to a projected subtask stage."
  [subtask-id
   {:keys [stage-name] :as current-stage}
   {:keys [event-name] :as event}]
  (let [next-name (or (get-in stage->definition [stage-name :transitions event-name])
                      (throw (ex-info (str "Illegal subtask transition from " stage-name
                                           " via " event-name ".")
                                      {:subtask subtask-id
                                       :from    stage-name
                                       :event   event})))]
    (match event
      {:event-name :specified :body _}
      {:stage-name next-name}

      {:event-name :reset}
      {:stage-name next-name}

      {:event-name :implementation-started :base base}
      {:stage-name next-name :base base}

      {:event-name :implementation-finished :commit commit :summary _ :agent _}
      (assoc current-stage :stage-name next-name :commit commit)

      {:event-name :check-passed}
      (assoc current-stage :stage-name next-name)

      {:event-name :check-failed :exit _ :output _}
      (assoc current-stage :stage-name next-name)

      {:event-name :approved :commit commit :summary _ :agent _}
      (assoc current-stage :stage-name next-name :commit commit)

      {:event-name :amended :commit commit :summary _ :agent _}
      (assoc current-stage :stage-name next-name :commit commit)

      {:event-name :feedback :feedback _ :agent _}
      (assoc current-stage :stage-name next-name)

      {:event-name :revision-finished :commit commit :summary _ :agent _}
      (assoc current-stage :stage-name next-name :commit commit)

      {:event-name :rebase-started :base base :source source}
      {:stage-name next-name :base base :source source}

      {:event-name :rebase-conflicted :output output}
      (assoc current-stage :stage-name next-name :output output)

      {:event-name :rebase-finished :commit commit}
      {:stage-name next-name :base (:base current-stage) :commit commit}

      {:event-name :branch-advanced :commit commit}
      (do
        (when-not (= commit (:commit current-stage))
          (throw (ex-info "Advanced commit does not match the current integration commit"
                          {:subtask            subtask-id
                           :integration-commit (:commit current-stage)
                           :event              event})))
        {:stage-name next-name})

      {:event-name :blocked :summary summary}
      {:stage-name next-name :summary summary})))

(defn subtask-stage
  "Fold durable subtask history into its current stage and required context. Blocked+reset pairs annul each other, so the fold lands on the stage the block interrupted."
  [state subtask-id]
  (assert-schema!
   Stage
   (reduce (partial transition-stage subtask-id)
           {:stage-name :initial}
           (effective-history (history state subtask-id)))))

(defn append-event
  "Append one legal timestamped subtask fact."
  ([state subtask-id event]
   (append-event state subtask-id event (now)))
  ([state subtask-id event at]
   (assert-schema! SubtaskEvent event)
   (assert-schema! Stage
                   (transition-stage subtask-id
                                     (subtask-stage state subtask-id)
                                     event))
   (update-in state [:subtasks subtask-id :history]
              conj
              (assert-schema! DurableSubtaskEvent (assoc event :at at)))))

(defn block-subtask [state subtask-id summary agent at]
  (append-event state subtask-id
                (cond-> {:event-name :blocked :summary summary}
                  agent (assoc :agent agent))
                at))

(defn append-revision-trigger [state subtask-id trigger at]
  (let [revisions (revision-trigger-count state subtask-id)
        triggered (append-event state subtask-id trigger at)]
    (if (< revisions MAX-REVISIONS)
      triggered
      (block-subtask triggered subtask-id "Revision limit reached." nil at))))

(defn step
  "Apply one control command or routed effect result, then schedule work."
  ([state event]
   (step state nil event (now)))

  ([state subtask-id event]
   (step state subtask-id event (now)))

  ([state subtask-id {:keys [event-name] :as event} at]
   (assert-schema! Event event)
   (assert-schema! Timestamp at)

   (if subtask-id
     (when-not (contains? effect-result-event-names event-name)
       (throw (ex-info "Routed event is not an effect result"
                       {:subtask subtask-id :event event})))
     (if (contains? effect-result-event-names event-name)
       (throw (ex-info "Effect result has no subtask routing context"
                       {:event event}))
       (assert-schema! ControlEvent event)))

   (schedule-transition
    (match event
      {:event-name :run-requested}
      state

      {:event-name :retry-requested :subtask id}
      (append-event state id {:event-name :reset} at)

      {:event-name :retry-requested}
      (reduce (fn [next-state {:keys [id]}]
                (if (= :blocked (:stage-name (subtask-stage next-state id)))
                  (append-event next-state id {:event-name :reset} at)
                  next-state))
              state
              (get-in state [:task :subtasks]))

      {:event-name (:or :check-failed :feedback)}
      (append-revision-trigger state subtask-id event at)

      {:event-name :effect-failed :summary summary}
      (block-subtask state subtask-id summary (:agent event) at)

      {:event-name :branch-advanced :commit commit}
      (-> (append-event state subtask-id event at)
          (assoc :tip commit))

      {:event-name :branch-stale :expected expected :actual actual}
      (throw (ex-info "The task branch moved outside the harness"
                      {:subtask subtask-id :expected expected :actual actual}))

      :else
      (append-event state subtask-id event at))
    at)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; workflow projections and outcomes

(def revision-trigger-event-names #{:check-failed :feedback})

(defn current-cycle-events [state subtask-id]
  (->> (history state subtask-id)
       reverse
       (take-while #(not (#{:specified :reset} (:event-name %))))))

(defn revision-trigger-count [state subtask-id]
  (count (filter (comp revision-trigger-event-names :event-name)
                 (current-cycle-events state subtask-id))))

(defn immediate-revision-trigger [state subtask-id]
  (when (#{:revising :revising-integration}
         (:stage-name (subtask-stage state subtask-id)))
    (let [{:keys [event-name] :as event}
          (last (effective-history (history state subtask-id)))]
      (when (revision-trigger-event-names event-name)
        event))))

(def event->agent-role
  {:implementation-finished :implementation
   :revision-finished       :implementation
   :approved                :review
   :amended                 :review
   :feedback                :review
   :rebase-finished         :conflict-resolution})

(defn commit-context
  "Project the subtask's events since it was specified into the material for its commit message."
  [state subtask-id]
  (let [newest-first (->> (effective-history (history state subtask-id))
                          reverse
                          (take-while #(not= :specified (:event-name %))))
        newest       (fn [event-names]
                       (first (filter (comp event-names :event-name) newest-first)))
        author       (:name (:agent (newest #{:implementation-finished :revision-finished})))
        summary      (->> newest-first
                          (filter (comp #{:implementation-finished :revision-finished
                                          :amended :approved}
                                        :event-name))
                          (some :summary))
        sessions     (reduce (fn [sessions {:keys [event-name agent]}]
                               (let [role (event->agent-role event-name)]
                                 (cond-> sessions
                                   (and role agent (not (contains? sessions role)))
                                   (assoc role (str (name (:harness agent)) " "
                                                    (:session-id agent))))))
                             {}
                             newest-first)]
    (cond-> {:subject  (:title (subtask-by-id state subtask-id))
             :notes    (->> (reverse newest-first)
                            (filter #(= :rebase-finished (:event-name %)))
                            (keep :note)
                            vec)
             :sessions sessions}
      author  (assoc :author author)
      summary (assoc :summary summary))))

(defn dependencies-integrated? [state {:keys [dependencies]}]
  (every? #(= :integrated (:stage-name (subtask-stage state %))) dependencies))

(defn ready-subtasks
  "Ready pending subtasks in stable task-document order."
  [state]
  (filterv (fn [{:keys [id] :as subtask}]
             (and (= :pending (:stage-name (subtask-stage state id)))
                  (dependencies-integrated? state subtask)))
           (get-in state [:task :subtasks])))

(def integration-stages
  #{:rebasing :resolving-integration :checking-integration :revising-integration :ready-to-advance})

(def active-stages
  (into integration-stages
        #{:implementing :checking :reviewing :checking-amendment :revising :awaiting-integration}))

(defn elapsed-ms [start end]
  (max 0 (- (.getTime ^java.util.Date end)
            (.getTime ^java.util.Date start))))

(defn later-timestamp [left right]
  (cond
    (nil? left)  right
    (nil? right) left
    (pos? (compare left right)) left
    :else right))

(defn stage-entered-at [state subtask-id]
  (:at (last (history state subtask-id))))

(defn current-stage-elapsed-ms [state subtask-id at]
  (when (active-stages (:stage-name (subtask-stage state subtask-id)))
    (elapsed-ms (later-timestamp (stage-entered-at state subtask-id)
                                 (:run-started-at state))
                at)))

(defn active-elapsed-ms
  "Elapsed time in active stages, including the open interval only while running."
  [state subtask-id at running?]
  (loop [stage               {:stage-name :initial}
         elapsed             0
         [event & remaining] (effective-history (history state subtask-id))]
    (if event
      (let [next-stage (transition-stage subtask-id stage event)
            end        (or (:at (first remaining)) (when running? at))
            run-start  (:run-started-at state)
            resumed?   (and run-start end
                            (pos? (compare run-start (:at event)))
                            (not (pos? (compare run-start end))))
            start      (if resumed? run-start (:at event))
            elapsed    (if (and end (active-stages (:stage-name next-stage)))
                         (+ elapsed (elapsed-ms start end))
                         elapsed)]
        (recur next-stage elapsed remaining))
      elapsed)))

(def empty-rework-cycle {:revisions 0 :amendments 0})

(defn format-rework-cycle
  "One cycle's rework: its revision count, suffixed `+n` when the reviewer amended n times."
  [{:keys [revisions amendments]}]
  (str (min MAX-REVISIONS revisions)
       (when (pos? amendments) (str "+" amendments))))

(defn subtask-rework
  "Dot-joined rework per implementation cycle, oldest cycle first.
  A cycle reads `2+1` when two revisions and one amendment went into it.
  Only the revisions count against the budget, so only they are capped.
  Nil until implementation first starts."
  [state subtask-id]
  (let [events (map :event-name (history state subtask-id))]
    (when (some #{:implementation-started} events)
      (->> events
           (reduce (fn [cycles event-name]
                     (cond
                       (= :specified event-name)
                       [empty-rework-cycle]

                       (= :reset event-name)
                       (conj cycles empty-rework-cycle)

                       (revision-trigger-event-names event-name)
                       (conj (pop cycles) (update (peek cycles) :revisions inc))

                       (= :amended event-name)
                       (conj (pop cycles) (update (peek cycles) :amendments inc))

                       :else cycles))
                   [empty-rework-cycle])
           (map format-rework-cycle)
           (str/join ".")))))

(defn integration-active-id [state]
  (some (fn [{:keys [id]}]
          (when (integration-stages (:stage-name (subtask-stage state id))) id))
        (get-in state [:task :subtasks])))

(defn next-integration-id [state]
  (->> (get-in state [:task :subtasks])
       (filter (fn [{:keys [id]}]
                 (= :awaiting-integration
                    (:stage-name (subtask-stage state id)))))
       ;; prefer first waiting subtask whose base is the current tip
       (sort-by #(not= (:tip state) (:base (subtask-stage state (:id %)))))
       first
       :id))

(defn complete? [state]
  (every? #(= :integrated (:stage-name (subtask-stage state %)))
          (keys (:subtasks state))))

(defn actionable? [state]
  (boolean
   (or (seq (ready-subtasks state))
       (some (fn [{:keys [id]}]
               (active-stages (:stage-name (subtask-stage state id))))
             (get-in state [:task :subtasks])))))

(defn blocked? [state] (and (not (complete? state)) (not (actionable? state))))

(defn outcome [state]
  (cond (complete? state) :complete
        (actionable? state) :actionable
        :else :blocked))

(defn test-plan-note
  "A pointer to the user's manual test plan, or nil when the task is not complete or has no plan."
  [task-dir outcome]
  (let [file (fs/path task-dir TEST-PLAN-FILENAME)]
    (when (and (= :complete outcome) (fs/exists? file))
      (str "Review manual test plan: "
           (fs/relativize (fs/cwd) (fs/absolutize file))))))

(defn format-duration [milliseconds]
  (when (some? milliseconds)
    (let [seconds (quot milliseconds 1000)
          hours   (quot seconds 3600)
          minutes (quot (mod seconds 3600) 60)
          seconds (mod seconds 60)]
      (if (pos? hours)
        (format "%d:%02d:%02d" hours minutes seconds)
        (format "%02d:%02d" minutes seconds)))))

(defn waiting-dependencies [state subtask-id]
  (remove #(= :integrated (:stage-name (subtask-stage state %)))
          (:dependencies (subtask-by-id state subtask-id))))

(defn subtask-number
  "1-based position of a subtask in document order."
  [state subtask-id]
  (first (keep-indexed (fn [index {:keys [id]}]
                         (when (= id subtask-id) (inc index)))
                       (get-in state [:task :subtasks]))))

(defn subtask-status [state subtask-id running?]
  (let [{:keys [stage-name summary]} (subtask-stage state subtask-id)
        waiting                      (waiting-dependencies state subtask-id)]
    (cond
      (and (active-stages stage-name) (not running?))
      (str "interrupted — was " (name stage-name))

      (= :blocked stage-name)
      (str "BLOCKED — " summary)

      (and (= :pending stage-name) (seq waiting))
      (str (if (some #(= :blocked (:stage-name (subtask-stage state %))) waiting)
             "unreachable" "pending")
           " — waits on " (str/join ", " (map #(subtask-number state %) waiting)))

      :else
      (name stage-name))))

(defn task-overview-rows [state running? at]
  (for [{:keys [id title]} (get-in state [:task :subtasks])]
    (let [rework (subtask-rework state id)]
      {:number (subtask-number state id)
       :title  title
       :status (subtask-status state id running?)
       :stage  (when running?
                 (format-duration (current-stage-elapsed-ms state id at)))
       :active (when rework
                 (format-duration (active-elapsed-ms state id at running?)))
       :rework rework})))

(defn render-task-overview [state task-dir running? at]
  (let [rows         (task-overview-rows state running? at)
        number-width (max 2 (reduce max 0 (map (comp count str :number) rows)))
        title-width  (max 7 (reduce max 0 (map (comp count :title) rows)))
        status-width (max 6 (reduce max 0 (map (comp count :status) rows)))
        rework-width (max 9 (reduce max 0 (map (comp count str :rework) rows)))
        row-format   (str "  %" number-width "s  %-" title-width "s  %-" status-width
                          "s  %8s  %8s  %" rework-width "s")
        heading      (format row-format "" "Subtask" "Status" "Stage" "Active" "Revisions")
        body         (for [{:keys [number title status stage active rework]} rows]
                       (format row-format number title status (or stage "—")
                               (or active "—") (or rework "—")))]
    (str/join "\n"
              (concat [(str "## " (get-in state [:task :title]))
                       (str (fs/relativize (fs/cwd)
                                           (fs/absolutize (fs/path task-dir TASK-FILENAME))))]
                      (when (and running? (:run-started-at state))
                        [(str "Run time: "
                              (format-duration
                               (elapsed-ms (:run-started-at state) at)))])
                      ["" heading]
                      body
                      (when-not running?
                        (some-> (test-plan-note task-dir (outcome state)) vector))))))

(defn reconcile-task
  "The single extension point for edits to an approved task document."
  [{:keys [task] :as state} observed-task]
  (if (= observed-task task)
    state
    ;; TODO: Translate approved task edits into specification and retry events.
    (throw (ex-info "Changing an approved task is not implemented yet" {}))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; scheduling and effect planning

(defn schedule-transition
  ([state]
   (schedule-transition state (now)))
  ([state at]
   (let [started (reduce (fn [next {:keys [id]}]
                           (append-event next id
                                         {:event-name :implementation-started
                                          :base       (:tip state)}
                                         at))
                         state
                         (ready-subtasks state))
         active  (integration-active-id started)
         chosen  (when-not active (next-integration-id started))]
     (if (and chosen
              (not= (:tip started) (:base (subtask-stage started chosen))))
       (let [{:keys [commit]} (subtask-stage started chosen)]
         (append-event started chosen
                       {:event-name :rebase-started
                        :base       (:tip started)
                        :source     commit}
                       at))
       started))))

(defn effects-for-state
  [state]
  (let [integration-id (or (integration-active-id state)
                           (next-integration-id state))
        effects        (->> (keys (:subtasks state))
                            (keep (fn [id]
                                    (let [{:keys [stage-name]} (subtask-stage state id)]
                                      ;; would be nice to clean up this logic a bit, maybe clearer to have "independent-stages" set?
                                      (when (or (= integration-id id)
                                                (not (or (integration-stages stage-name)
                                                         (= :awaiting-integration stage-name))))
                                        (effect-for-stage state id))))))]

    ;; prioritize effects for the subtask being integrated.
    (vec (sort-by #(not= integration-id (:subtask %)) effects))))

(defn effective-checks
  "Task-level checks followed by the subtask's own checks, in document order."
  [state subtask-id]
  (into (vec (get-in state [:task :checks]))
        (:checks (subtask-by-id state subtask-id))))

(defn effect-for-stage [state subtask-id]
  (let [{:keys [stage-name base commit source output]} (subtask-stage state subtask-id)
        common                                         {:subtask subtask-id}
        effect
        (case stage-name
          :implementing
          (merge common
                 {:effect-name  :implement
                  :base         base
                  :instructions (build-implementation-instructions state subtask-id)})

          :revising
          (merge common
                 {:effect-name  :revise
                  :base         base
                  :previous     commit
                  :instructions (build-implementation-instructions state subtask-id)})

          (:checking :checking-amendment)
          (merge common {:effect-name :check
                         :commit      commit
                         :checks      (effective-checks state subtask-id)})

          :reviewing
          (merge common
                 {:effect-name  :review
                  :base         base
                  :commit       commit
                  :instructions (build-review-instructions state subtask-id)})

          :rebasing
          (merge common
                 {:effect-name :attempt-rebase
                  :base        base
                  :source      source})

          :resolving-integration
          (merge common
                 {:effect-name  :resolve-rebase
                  :base         base
                  :source       source
                  :output       output
                  :instructions (build-rebase-resolution-instructions state subtask-id output)})

          :checking-integration
          (merge common {:effect-name :check
                         :commit      commit
                         :checks      (effective-checks state subtask-id)})

          :revising-integration
          (merge common
                 {:effect-name  :revise
                  :base         base
                  :previous     commit
                  :instructions (build-implementation-instructions state subtask-id)})

          (:awaiting-integration :ready-to-advance)
          (merge common
                 {:effect-name :advance-branch
                  :expected    (:tip state)
                  :new-tip     commit})

          nil)]
    (cond-> effect
      (#{:implement :revise :review :attempt-rebase :resolve-rebase}
       (:effect-name effect))
      (assoc :commit-context (commit-context state subtask-id)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; prompt construction

(defn subtask-by-id
  [state subtask-id]
  (some #(when (= subtask-id (:id %)) %) (get-in state [:task :subtasks])))

(defn md
  "Join markdown blocks with blank lines. Drops nils, splices seqs."
  [& blocks]
  (->> blocks
       (mapcat #(if (seq? %) % [%]))
       (remove nil?)
       (str/join "\n\n")))

(defn h1 [s] (str "# " s))
(defn h2 [s] (str "## " s))

(defn bullets [items]
  (->> items
       (map #(str "- " %))
       (str/join "\n")))

(def WORKTREE-CONTEXT
  "Your current directory is the repository root of a temporary git worktree. Treat every path in the task as relative to the current directory, even if it is written as absolute. Do not create, switch, or delete git branches, and do not commit; the harness owns all version-control state, and any instruction to put work on a branch does not apply here.")

(def SUMMARY-CONTEXT
  "The summary you report becomes the body of a commit message. Write it in the imperative mood, one sentence per line, never hard-wrapped; blank-line-separated paragraphs are allowed. Describe what the finished work does and why, not the process that produced it. Include no subject line, bullet list, or trailer.")

(defn task-context
  "The blocks shared by every subtask prompt: task heading and body, subtask heading and body."
  [task sub]
  (list (h1 (:title task)) (:body task)
        (h2 (:title sub)) (:body sub)))

(defn final-answer-instructions
  [schema]
  (str "When the work is finished, the final response must contain only a JSON object matching this schema, with no Markdown fences or other text:\n"
       (json/generate-string (mjs/transform schema))))

(defn build-implementation-instructions
  [{:keys [task] :as state} subtask-id]
  (let [sub      (subtask-by-id state subtask-id)
        revision (match (immediate-revision-trigger state subtask-id)
                   nil
                   nil

                   {:event-name :feedback :feedback feedback}
                   (list "Review feedback to satisfy:"
                         (bullets (for [{:keys [title body]} feedback]
                                    (str title ": " body))))

                   {:event-name :check-failed :command command :exit exit :output output}
                   (list (str "The check `" command "` failed (exit " exit "):")
                         output))]
    (md "Implement exactly one subtask in this git worktree."
        WORKTREE-CONTEXT
        SUMMARY-CONTEXT
        (task-context task sub)
        revision
        "Work only on this subtask.")))

(defn build-review-instructions
  [{:keys [task] :as state} subtask-id]
  (md "Review the checked commit for conformance to this task and subtask."
      WORKTREE-CONTEXT
      SUMMARY-CONTEXT
      "Work through the subtask body one requirement at a time and name the code that satisfies each.
Report any requirement you cannot point at, and any whose code does the opposite of what the sentence says.
A check that passes is not evidence that a requirement is met; many requirements are exercised by no check at all, so read the code."
      "The worktree files are the commit under review. Choose one outcome:"
      (bullets
       ["`approved` — the commit is correct as it stands and you changed no files; summarize the commit as a whole in its final state, not your review of it"
        "`amended` — you found problems a few edits can fix (stale docs, misleading comments, naming, small test gaps) and fixed them yourself by editing the worktree files; summarize every fix, and make no changes beyond what the review requires, because your edits go to integration once the checks pass rather than to another review"
        "`revision-requested` — the problems need rework larger than a few edits; change no files and report actionable feedback instead"])
      "Prefer amending over requesting a revision when a few edits would satisfy the review."
      (task-context task (subtask-by-id state subtask-id))))

(defn build-rebase-resolution-instructions
  [{:keys [task] :as state} subtask-id output]
  (md "Resolve a cherry-pick conflict while rebasing this subtask for integration."
      WORKTREE-CONTEXT
      SUMMARY-CONTEXT
      "Your summary explains which side of each conflict survived and why, because it is recorded in the commit."
      (task-context task (subtask-by-id state subtask-id))
      "The worktree contains the recreated conflict. Preserve the intent of both the current task tip and the original subtask diff."
      (list "Cherry-pick output:" output)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; commit messages

(defn render-trailers
  [sessions]
  (when (seq sessions)
    (->> (keys role->agent)
         (keep (fn [role]
                 (when-let [session (sessions role)]
                   (str (str/capitalize (name role)) "-session: " session))))
         (str/join "\n"))))

(defn render-commit
  [context {:keys [role agent summary note]}]
  (let [pending-name (:name agent)
        author       (or (:author context) pending-name)
        summary      (or summary (:summary context))
        notes        (cond-> (:notes context) note (conj note))
        sessions     (cond-> (:sessions context)
                       agent (assoc role (str (name (:harness agent)) " " (:session-id agent))))]
    {:subject   (:subject context)
     :body      (md summary (seq notes) (render-trailers sessions))
     :author    author
     :committer (or pending-name author)}))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; effect interpretation

(defn perform!
  "Interpret effect in worktree (if provided)"
  [runtime worktree {:keys [effect-name] :as effect}]
  (assert-schema! Effect effect)
  (let [handler                        (case effect-name
                                         (:implement :revise) perform-implementation!
                                         :check perform-check!
                                         :review perform-review!
                                         :attempt-rebase perform-attempt-rebase!
                                         :resolve-rebase perform-resolve-rebase!
                                         :advance-branch perform-advance!)
        {:keys [event-name] :as event} (try
                                         (handler runtime worktree effect)
                                         (catch Exception error
                                           (effect-failure-event error)))
        allowed                        (get-in effect->definition [effect-name :results])]
    (assert-schema! Event event)
    (when-not (or (= :effect-failed event-name)
                  (allowed event-name))
      (throw (ex-info "Effect returned an unexpected event"
                      {:effect effect :event event :allowed allowed})))
    event))

(defn effect-failure-event
  [error]
  (cond-> {:event-name :effect-failed
           :summary    (or (ex-message error) (str error))}
    (:agent (ex-data error)) (assoc :agent (:agent (ex-data error)))))

(defn advance-result-event
  [{:keys [new-tip expected]} result]
  (match result
    {:outcome :advanced :commit commit}
    {:event-name :branch-advanced
     :commit     commit}

    {:outcome :stale :actual actual}
    (if (= actual new-tip)
      ;; A replay after the CAS succeeded but before :branch-advanced was saved.
      {:event-name :branch-advanced
       :commit     actual}
      {:event-name :branch-stale
       :expected   expected
       :actual     actual})

    _
    (throw (ex-info "Unknown branch advance outcome" {:result result}))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; effect handlers

(defn perform-implementation!
  [{:keys [vcs] :as runtime}
   worktree
   {:keys [effect-name base previous instructions commit-context] :as effect}]
  (let [dir (prepare-effect-worktree! runtime worktree (or previous base))
        {:keys [agent answer]}
        (invoke-agent! dir instructions ImplementationAnswer
                       (role->agent :implementation) (agent-log-file runtime))]
    (match answer
      {:outcome :blocked :summary summary}
      {:event-name :blocked :summary summary :agent agent}

      {:outcome :done :summary summary}
      (let [commit (or (commit-worktree! vcs dir base
                                         (render-commit commit-context
                                                        {:role    :implementation
                                                         :agent   agent
                                                         :summary summary}))
                       (throw (ex-info "Agent reported done but produced no repository changes"
                                       {:effect effect :agent agent})))]
        {:event-name (case effect-name
                       :implement :implementation-finished
                       :revise :revision-finished)
         :commit     commit
         :summary    summary
         :agent      agent})

      _
      (throw (ex-info "Unknown implementation outcome"
                      {:answer answer :agent agent})))))

(defn perform-check!
  [runtime worktree {:keys [commit checks]}]
  (let [dir (prepare-effect-worktree! runtime worktree commit)]
    (loop [[command & remaining] checks]
      (if-not command
        {:event-name :check-passed}
        (let [{:keys [exit out err]} (run-process-with-timeout!
                                      ["sh" "-c" command] dir CHECK-TIMEOUT-MS)]
          (if (zero? exit)
            (recur remaining)
            {:event-name :check-failed
             :command    command
             :exit       exit
             :output     (str out err)}))))))

(defn perform-review!
  [{:keys [vcs] :as runtime}
   worktree
   {:keys [base commit instructions commit-context]}]
  (let [dir                    (prepare-effect-worktree! runtime worktree commit)
        show                   (show-commit vcs commit)
        full-instructions      (md instructions (h2 "Commit under review") show)
        {:keys [agent answer]} (invoke-agent! dir full-instructions ReviewAnswer
                                              (role->agent :review) (agent-log-file runtime))]

    (match answer
      {:outcome :approved :summary summary}
      ;; Restore the reviewed tree first: the reviewer may leave files behind,
      ;; and approval promises no changes beyond the commit under review.
      (let [dir      (prepare-effect-worktree! runtime worktree commit)
            approved (or (commit-worktree! vcs dir base
                                           (render-commit commit-context
                                                          {:role    :review
                                                           :agent   agent
                                                           :summary summary}))
                         commit)]
        {:event-name :approved :commit approved :summary summary :agent agent})

      {:outcome :amended :summary summary}
      (let [amended (or (commit-worktree! vcs dir base
                                          (render-commit commit-context
                                                         {:role    :review
                                                          :agent   agent
                                                          :summary summary}))
                        (throw (ex-info "Reviewer reported amended but produced no repository changes"
                                        {:answer answer :agent agent})))]
        {:event-name :amended :commit amended :summary summary :agent agent})

      {:outcome :revision-requested :feedback feedback}
      {:event-name :feedback :agent agent :feedback feedback}

      _
      (throw (ex-info "Unknown review outcome" {:answer answer :agent agent})))))

(defn perform-attempt-rebase!
  [{:keys [vcs] :as runtime}
   worktree
   {:keys [base source commit-context]}]
  (let [dir (prepare-effect-worktree! runtime worktree base)]
    (match (apply-commit! vcs dir source)
      {:outcome :applied}
      {:event-name :rebase-finished
       :commit     (or (commit-worktree! vcs dir base (render-commit commit-context {}))
                       base)}

      {:outcome :conflict :output output}
      {:event-name :rebase-conflicted
       :output     output})))

(defn perform-resolve-rebase!
  [{:keys [vcs] :as runtime}
   worktree
   {:keys [base source instructions commit-context]}]
  (let [dir (prepare-effect-worktree! runtime worktree base)]
    (match (apply-commit! vcs dir source)
      {:outcome :applied}
      {:event-name :rebase-finished
       :commit     (or (commit-worktree! vcs dir base (render-commit commit-context {}))
                       base)}

      {:outcome :conflict}
      (let [diff                   (show-commit vcs source)
            full-instructions      (md instructions (h2 "Original diff from the older base") diff)
            {:keys [agent answer]} (invoke-agent! dir full-instructions ImplementationAnswer
                                                  (role->agent :conflict-resolution)
                                                  (agent-log-file runtime))]
        (match answer
          {:outcome :done :summary summary}
          (let [note (str "Resolved replaying " source " onto " base " — " summary)]
            {:event-name :rebase-finished
             :commit     (or (commit-worktree! vcs dir base
                                               (render-commit commit-context
                                                              {:role  :conflict-resolution
                                                               :agent agent
                                                               :note  note}))
                             base)
             :note       note
             :agent      agent})

          {:outcome :blocked :summary summary}
          {:event-name :blocked :summary summary :agent agent})))))

(defn perform-advance!
  [{:keys [vcs task-id]} _worktree {:keys [expected new-tip] :as effect}]
  (->> (advance-task! vcs task-id expected new-tip)
       (advance-result-event effect)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; effect handler support

(defn prepare-effect-worktree! [{:keys [vcs]} worktree commit]
  (when-not worktree
    (throw (ex-info "Effect requires a worktree" {:commit commit})))
  (prepare-worktree! vcs commit worktree))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; task document parsing and validation

(defn slugify [s]
  (->> (str/split (str/lower-case s) #"\s+")
       (map #(str/replace % #"[^a-z0-9]" ""))
       (remove str/blank?)
       (str/join "-")))

(defn parse-error [line message]
  (throw (ex-info (str TASK-FILENAME " line " line ": " message)
                  {:line line :parse-error true})))

(defn markdown-heading [text]
  (when-let [[_ hashes raw-title]
             (re-matches #" {0,3}(#{1,6})[ \t]+(.*)" text)]
    {:level (count hashes)
     :title (-> raw-title
                (str/replace #"[ \t]+#+[ \t]*$" "")
                str/trim)}))

(defn markdown-lines [text]
  (mapv (fn [i line]
          {:line    (inc i)
           :text    line
           :heading (markdown-heading line)})
        (range)
        (str/split-lines text)))

(defn malformed-subtask-heading? [{:keys [text]}]
  (re-matches #" {0,3}###(?:$|[^# \t].*)" text))

(defn subtask-sections [lines]
  (reduce (fn [sections {:keys [line heading] :as source-line}]
            (cond
              (= 3 (:level heading))
              (conj sections {:line line :title (:title heading) :body []})

              (malformed-subtask-heading? source-line)
              (parse-error line "subtask heading must be `### <title>`")

              (seq sections)
              (update-in sections [(dec (count sections)) :body] conj source-line)

              :else
              sections))
          [] lines))

(def frontmatter-line-pattern
  #"[ \t]*([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)")

(def dependency-id-pattern #"[a-z0-9]+(?:-[a-z0-9]+)*")

(defn frontmatter-entry [{:keys [line text]}]
  (when-let [[_ key value] (re-matches frontmatter-line-pattern text)]
    {:line line :key (keyword (str/lower-case key)) :value value}))

(defn split-frontmatter
  "Split section lines into [frontmatter-entries body-lines].
  Frontmatter is the leading run of `key: value` lines, and only counts
  when a blank line (or the section end) follows the run; otherwise the
  run is body text."
  [section-lines]
  (let [lines     (drop-while (comp str/blank? :text) section-lines)
        entries   (vec (take-while some? (map frontmatter-entry lines)))
        remaining (drop (count entries) lines)]
    (if (and (seq entries)
             (or (empty? remaining)
                 (str/blank? (:text (first remaining)))))
      [entries remaining]
      [[] section-lines])))

(defn assert-known-frontmatter! [entries allowed-keys]
  (doseq [{:keys [line key]} entries]
    (when-not (allowed-keys key)
      (parse-error line (str "unknown frontmatter key `" (name key) "`"
                             " (allowed: "
                             (str/join ", " (sort (map name allowed-keys)))
                             "); if this line is body text, follow it with a"
                             " non-blank line")))))

(defn frontmatter-values [entries key]
  (filterv #(= key (:key %)) entries))

(defn parse-dependencies [entries]
  (->> (frontmatter-values entries :dependencies)
       (mapv (fn [{:keys [line value]}]
               (let [ids (->> (str/split value #"[,\s]+")
                              (remove str/blank?))]
                 (when (empty? ids)
                   (parse-error line "dependencies frontmatter must name at least one slug id"))
                 ids)))
       (apply concat)
       (map keyword)
       distinct
       vec))

(defn parse-checks [entries]
  (mapv (fn [{:keys [line value]}]
          (let [command (str/trim value)]
            (when (str/blank? command)
              (parse-error line "check frontmatter must be a shell command"))
            command))
        (frontmatter-values entries :check)))

(defn parse-subtask [{:keys [title body]}]
  (let [[entries body-lines] (split-frontmatter body)]
    (assert-known-frontmatter! entries #{:check :dependencies})
    {:id           (keyword (slugify title))
     :title        title
     :dependencies (parse-dependencies entries)
     :checks       (parse-checks entries)
     :body         (->> body-lines
                        (map :text)
                        (str/join "\n")
                        str/trim)}))

(defn parse-task [text]
  (let [lines                (markdown-lines text)
        first-heading        (:heading (first lines))
        title                (if (and (= 1 (:level first-heading))
                                      (not (str/blank? (:title first-heading))))
                               (:title first-heading)
                               (parse-error 1 "first line must be `# <title>`"))
        divider-index        (first (keep-indexed (fn [i {:keys [heading]}]
                                                    (when (and (= 2 (:level heading))
                                                               (= "Subtasks" (:title heading)))
                                                      i))
                                                  lines))
        [entries body-lines] (split-frontmatter
                              (subvec lines 1 (or divider-index (count lines))))
        _                    (assert-known-frontmatter! entries #{:check})
        body                 (->> body-lines
                                  (map :text)
                                  (str/join "\n")
                                  str/trim)
        sections             (subtask-sections (if divider-index
                                                 (subvec lines (inc divider-index)) []))
        parsed               (mapv parse-subtask sections)]
    (assert-schema! TaskSpec
                    {:title    title
                     :body     body
                     :checks   (parse-checks entries)
                     :subtasks parsed})))

(def parse parse-task)

(defn find-cycle [dependencies]
  (letfn [(visit [id path done]
            (cond
              (some #{id} path)
              [done (conj (vec (drop-while #(not= id %) path)) id)]
              (done id) [done nil]
              :else
              (let [[done cycle]
                    (reduce (fn [[seen found] dep]
                              (if found [seen found]
                                  (visit dep (conj path id) seen)))
                            [done nil] (get dependencies id []))]
                [(conj done id) cycle])))]
    (second
     (reduce (fn [[done cycle] id]
               (if cycle [done cycle] (visit id [] done)))
             [#{} nil] (keys dependencies)))))

(defn task-errors [{:keys [title subtasks]}]
  (let [ids           (mapv :id subtasks)
        id-set        (set ids)
        duplicate-ids (->> ids frequencies (keep (fn [[id n]] (when (< 1 n) id))))
        invalid-deps  (for [{:keys [id dependencies]} subtasks
                            dep                       dependencies
                            :when                     (not (re-matches dependency-id-pattern
                                                                       (subs (str dep) 1)))]
                        (str "subtask `" (name id) "` has invalid dependency id `"
                             (subs (str dep) 1) "`"))
        dangling      (for [{:keys [id dependencies]} subtasks
                            dep                       dependencies
                            :when                     (and (re-matches dependency-id-pattern
                                                                       (subs (str dep) 1))
                                                           (not (id-set dep)))]
                        (str "subtask `" (name id) "` depends on `"
                             (name dep) "`, which does not exist"))
        cycle         (when (and (empty? duplicate-ids)
                                 (empty? invalid-deps)
                                 (empty? dangling))
                        (find-cycle (into {} (map (juxt :id :dependencies) subtasks))))]
    (vec (concat
          (when (str/blank? (slugify title))
            ["The task title slugifies to nothing."])
          (when (empty? subtasks)
            [(str "The draft has no subtasks; run `" COMMAND-NAME " plan`.")])
          (for [{:keys [id]} subtasks :when (str/blank? (name id))]
            "subtask title slugifies to nothing")
          (for [id duplicate-ids]
            (str "duplicate subtask id `" (name id) "`"))
          (for [{:keys [id body]} subtasks :when (str/blank? body)]
            (str "subtask `" (name id) "` has no body"))
          invalid-deps
          dangling
          (when cycle [(str "dependency cycle: "
                            (str/join " → " (map name cycle)))])))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; state persistence and task discovery

(defn tasktron-path [{:keys [tasktron-root]} & parts]
  (apply fs/path tasktron-root parts))

(defn wip-dir [runtime] (tasktron-path runtime WIP-DIRECTORY))
(defn wip-md [runtime] (fs/path (wip-dir runtime) TASK-FILENAME))

(defn task-runtime
  "Attach stable task identity and location to repository-scoped infrastructure."
  [runtime dir {:keys [task-id]}]
  (let [scoped (assoc runtime
                      :task-id task-id
                      :task-dir (str dir))]
    (assert-schema! TaskRuntime scoped)))

(defn state-file [dir] (fs/path dir STATE-FILENAME))
(defn run-lock-file [dir] (fs/path dir RUN-LOCK-FILENAME))
(defn agent-log-file [{:keys [task-dir]}]
  (when task-dir (fs/path task-dir AGENT-LOG-FILENAME)))

(defn read-state! [dir]
  (->> (slurp (str (state-file dir)))
       edn/read-string
       (assert-schema! State)))

(defn save! [dir state]
  (assert-schema! State state)
  (let [file (state-file dir)
        tmp  (fs/path dir (str "." STATE-FILENAME "." (random-uuid) ".tmp"))]
    (spit (str tmp)
          (format-clj (with-out-str (pprint/pprint state))))
    (fs/move tmp file {:replace-existing true :atomic-move true}))
  state)

(defn open-task-lock-channel [dir]
  (java.nio.channels.FileChannel/open
   (run-lock-file dir)
   (into-array java.nio.file.OpenOption
               [java.nio.file.StandardOpenOption/CREATE
                java.nio.file.StandardOpenOption/WRITE])))

(defn try-task-lock [dir]
  (let [channel (open-task-lock-channel dir)]
    (try
      (if (try
            (.tryLock channel)
            (catch Exception error
              (if (= "java.nio.channels.OverlappingFileLockException"
                     (.getName (class error)))
                nil
                (throw error))))
        channel
        (do (.close channel) nil))
      (catch Exception error
        (.close channel)
        (throw error)))))

(defn acquire-task-lock! [dir]
  (or (try-task-lock dir)
      (die! (str "Task `" (fs/file-name dir) "` is already running."))))

(defn task-running? [dir]
  (if-let [channel (try-task-lock dir)]
    (do (.close channel) false)
    true))

(defn worktree-dir [{:keys [task-dir]} slot]
  (str (fs/path task-dir WORKTREES-DIRECTORY (str slot))))

(defn live-task-dirs [{:keys [tasktron-root]}]
  (if (fs/directory? tasktron-root)
    (->> (fs/list-dir tasktron-root)
         (filter fs/directory?)
         (remove #(#{WIP-DIRECTORY WORKTREES-DIRECTORY COMPLETED-DIRECTORY}
                   (fs/file-name %)))
         (filter #(fs/exists? (fs/path % STATE-FILENAME)))
         (sort-by fs/file-name))
    []))

(defn resolve-task-dir [runtime name]
  (let [dirs    (live-task-dirs runtime)
        matches (if name
                  (filter #(str/starts-with? (fs/file-name %) name) dirs)
                  dirs)]
    (case (count matches)
      1 (first matches)
      0 (die! (if name (str "No approved task matches `" name "`.")
                  "No approved task."))
      (die! "Several approved tasks match; name one."))))

(defn resolve-subtask-id [{:keys [subtasks]} text]
  (let [matches (filter #(str/starts-with? (name %) text) (keys subtasks))]
    (case (count matches)
      1 (first matches)
      0 (die! (str "No subtask matches `" text "`."))
      (die! (str "Subtask prefix `" text "` is ambiguous.")))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; filesystem and process utilities

(defn sh [& args]
  (-> (apply p/shell {:out :string :err :string :continue true} args)
      (select-keys [:exit :out :err])))

(defn sh! [& args]
  (let [result (apply sh args)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str (first args) " failed: " (str/trim (:err result))) result)))
    result))

(defn destroy-process!
  "Terminate a process and its descendants, and wait for the whole tree to exit."
  [^java.lang.Process process]
  (try
    (let [handle  (.toHandle process)
          ;; Descendants leave the tree once the parent dies, so collect them first.
          tree    (cons handle (doall (iterator-seq (.iterator (.descendants handle)))))
          alive?  (fn [] (some (fn [^java.lang.ProcessHandle each] (.isAlive each)) tree))
          exited? (fn []
                    (let [deadline (+ (System/currentTimeMillis) PROCESS-EXIT-GRACE-MS)]
                      (loop []
                        (cond
                          (not (alive?))                          true
                          (< deadline (System/currentTimeMillis)) false
                          :else                                   (do (Thread/sleep 50) (recur))))))]
      (doseq [^java.lang.ProcessHandle each tree] (.destroy each))
      (when-not (exited?)
        (doseq [^java.lang.ProcessHandle each tree] (.destroyForcibly each))
        (exited?)))
    (catch Exception _)))

(defn terminate-processes! [processes]
  (doseq [process (first (swap-vals! processes (constantly #{})))]
    (destroy-process! process)))

(defn run-process-with-timeout!
  ([argv dir timeout-ms]
   (run-process-with-timeout! argv dir timeout-ms {}))
  ([argv dir timeout-ms options]
   (let [proc    (apply p/process
                        (merge {:out :string :err :string :dir dir} options)
                        argv)
         process (:proc proc)]
     (when *task-processes* (swap! *task-processes* conj process))
     (try
       (let [result (deref proc timeout-ms ::timeout)]
         (if (= ::timeout result)
           (do (destroy-process! process)
               {:exit 124 :out "" :err (str "timed out after " timeout-ms " ms")})
           (select-keys result [:exit :out :err])))
       (catch Exception error
         (destroy-process! process)
         (throw error))
       (finally
         (when *task-processes* (swap! *task-processes* disj process)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; agent harness adapter

(defn agent-process-options [{:keys [harness]}]
  (cond-> {}
    (= :claude-code harness) (assoc :extra-env {"IS_SANDBOX" "1"})))

(defn decode-agent-answer [schema data]
  (let [answer      (m/decode schema data mt/json-transformer)
        explanation (m/explain schema answer)]
    (when explanation
      (throw (ex-info "Agent answer failed schema validation"
                      {:answer answer :errors explanation})))
    answer))

(defn parse-agent-answer [schema text]
  (let [values (-> (str/trim text)
                   java.io.StringReader.
                   (json/parsed-seq true)
                   doall)]
    (when-not (= 1 (count values))
      (throw (ex-info "Agent response must contain exactly one JSON value"
                      {:json-values (count values)})))
    (let [data (first values)]
      (when-not (map? data)
        (throw (ex-info "Agent response must be a JSON object" {:value data})))
      (decode-agent-answer schema data))))

(defn prompt-answer-correction [schema error]
  (md "The work attempt is finished. Do not continue implementing or reviewing. Do not modify any files. Correct only the final report."
      (str "The previous report was invalid:\n" (ex-message error)
           (when-let [data (ex-data error)]
             (str "\n" (pr-str data))))
      (final-answer-instructions schema)))

(defn agent-command
  "Build the harness argv. Headless argv carries no prompt: both harnesses read
  a piped stdin as the message, and execve caps each argv string at
  MAX_ARG_STRLEN (128 KiB at 4 KiB pages), which prompts embedding a large diff
  exceed. Interactive mode keeps the prompt in argv because piped stdin forces
  both harnesses into print mode."
  [{:keys [harness model thinking] :as agent}
   {:keys [mode system prompt session-id resume?] :as options}]
  (assert-schema! AgentConfig agent)
  (assert-schema! AgentCommandOptions options)
  (let [headless? (= mode :headless)
        thinking  (name thinking)]
    (case harness
      :claude-code
      (cond-> ["claude"]
        headless?       (conj "-p")
        true            (conj "--allow-dangerously-skip-permissions"
                              "--dangerously-skip-permissions"
                              "--model" model "--effort" thinking)
        (some? system)  (conj "--append-system-prompt" system)
        headless?       (conj (if resume? "--resume" "--session-id") session-id)
        (and (not headless?) (some? prompt)) (conj prompt))

      :pi
      (cond-> ["pi"]
        headless?       (conj "-p")
        true            (conj "--approve" "--model" model "--thinking" thinking)
        (some? system)  (conj "--append-system-prompt" system)
        headless?       (conj "--session-id" session-id)
        (and (not headless?) (some? prompt)) (conj prompt)))))

(defn exec-agent!
  "Replace Tasktron with an interactive agent harness running at dir; never returns."
  [dir system prompt agent]
  (let [argv    (agent-command agent {:mode :interactive :system system :prompt prompt})
        options (agent-process-options agent)]
    ;; babashka.process/exec cannot set cwd. The shell changes directory and then
    ;; replaces itself, leaving no Tasktron or shell process around the harness.
    (apply p/exec options
           (into ["sh" "-c"
                  "cd \"$1\" || exit $?; shift; exec \"$@\""
                  COMMAND-NAME (str dir)]
                 argv))))

(def agent-log-lock (Object.))

(defn write-agent-log! [file data]
  (when file
    (locking agent-log-lock
      (spit (str file)
            (str "\n=== " (java.time.Instant/now) " agent invocation failure ===\n"
                 (with-out-str (pprint/pprint data)))
            :append true))))

(defn throw-agent-invocation-error! [log-file message data]
  (write-agent-log! log-file data)
  (throw (ex-info (str message (when log-file (str "; see " log-file))) data)))

(defn fail-agent-invocation! [log-file message metadata data]
  (throw-agent-invocation-error! log-file message (assoc data :agent metadata)))

(defn run-agent-attempt!
  [dir prompt agent metadata attempt deadline log-file failures]
  (let [remaining (- deadline (System/currentTimeMillis))]
    (cond
      (not (pos? remaining))
      (fail-agent-invocation! log-file "Agent invocation timed out" metadata
                              {:status 124 :failures failures})

      :else
      (let [argv    (agent-command agent {:mode       :headless
                                          :session-id (:session-id metadata)
                                          :resume?    (> attempt 1)})
            ;; The prompt goes over stdin, which has no size limit, unlike argv.
            options (assoc (agent-process-options agent) :in prompt)
            result  (run-process-with-timeout! argv dir remaining options)]
        (cond
          (not (zero? (:exit result)))
          (fail-agent-invocation! log-file "Agent invocation failed" metadata
                                  {:status   (:exit result)
                                   :text     (str (:out result) (:err result))
                                   :failures failures})

          :else
          (:out result))))))

(defn parse-agent-attempt [schema raw]
  (try
    {:answer (parse-agent-answer schema raw)}
    (catch Exception error
      {:error   error
       :failure {:raw-response raw
                 :error        (ex-message error)
                 :details      (ex-data error)}})))

(defn invoke-agent!
  [dir instructions schema agent log-file]
  ;; TODO: Persist AgentMetadata before launch for crash recovery. Result events
  ;; are saved only after the agent returns, so an interruption loses the session ID.
  (let [metadata       {:harness (:harness agent) :session-id (str (random-uuid)) :name (:name agent)}
        deadline       (+ (System/currentTimeMillis) AGENT-TIMEOUT-MS)
        initial-prompt (md instructions (final-answer-instructions schema))]
    (loop [attempt   1
           next-text initial-prompt
           failures  []]
      (let [raw                            (run-agent-attempt! dir next-text agent metadata attempt
                                                               deadline log-file failures)
            {:keys [answer error failure]} (parse-agent-attempt schema raw)
            failures                       (cond-> failures failure (conj failure))]
        (cond
          answer
          {:agent metadata :answer answer}

          (< attempt AGENT-ANSWER-ATTEMPTS)
          (recur (inc attempt)
                 (prompt-answer-correction schema error)
                 failures)

          :else
          (fail-agent-invocation!
           log-file "Agent returned invalid answers" metadata
           {:raw-responses     (mapv :raw-response failures)
            :validation-errors (mapv #(select-keys % [:error :details])
                                     failures)}))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; Git VCS adapter

(defn git-result [root & args]
  (apply sh "git" "-C" root args))

(defn git-result! [root & args]
  (apply sh! "git" "-C" root args))

(defn git-output [root & args]
  (str/trim (:out (apply git-result! root args))))

(defn task-branch [task-id] (str "tt/" (name task-id)))
(defn branch-ref [task-id] (str "refs/heads/" (task-branch task-id)))

(def SHOW-COMMIT-LIMIT-BYTES
  "A rendered commit above this size collapses to its stat summary, keeping review prompts well inside the agent context window."
  200000)

(defrecord GitVcs [root]
  IVcs
  (task-tip [_ task-id]
    (let [result (git-result root "rev-parse" "--verify" "--quiet"
                             (str (branch-ref task-id) "^{commit}"))]
      (when (zero? (:exit result))
        (str/trim (:out result)))))

  (create-task! [_ task-id]
    (let [tip (git-output root "rev-parse" "HEAD")]
      (git-result! root "update-ref" (branch-ref task-id) tip)
      tip))

  (task-target [_ task-id]
    (task-branch task-id))

  (prepare-worktree! [_ commit dir]
    (fs/create-dirs (fs/parent (fs/path dir)))
    (if (fs/directory? dir)
      (do
        (git-result dir "cherry-pick" "--abort")
        ;; Force a detached checkout rather than reset --hard: an agent may
        ;; have attached HEAD to a branch, and a reset would drag it along.
        (git-result! dir "checkout" "--force" "--detach" commit)
        (git-result! dir "clean" "-fd"))
      (do
        (git-result root "worktree" "prune")
        (git-result! root "worktree" "add" "--relative-paths" "--detach" (str dir) commit)))
    (str dir))

  (remove-worktree! [_ dir]
    ;; An agent leaves the worktree dirty, so removal needs --force.
    (when-not (zero? (:exit (git-result root "worktree" "remove" "--force" (str dir))))
      ;; A registration goes stale when a worktree loses its administrative
      ;; data; pruning drops that record so the removal can succeed.
      (git-result root "worktree" "prune")
      (when (fs/exists? dir)
        (git-result! root "worktree" "remove" "--force" (str dir)))))

  (apply-commit! [_ dir commit]
    (let [result    (git-result dir "cherry-pick" "--no-commit" commit)
          conflicts (git-output dir "diff" "--name-only" "--diff-filter=U")]
      (cond
        (zero? (:exit result))
        {:outcome :applied}

        (seq conflicts)
        {:outcome :conflict
         :output  (str (:out result) (:err result))}

        :else
        (do
          (git-result dir "cherry-pick" "--abort")
          (throw (ex-info "Could not apply commit" result))))))

  (commit-worktree! [_ dir base {:keys [subject body author committer]}]
    (git-result! dir "reset" "--soft" base)
    (git-result! dir "add" "-A")
    (when-not (zero? (:exit (git-result dir "diff" "--cached" "--quiet")))
      (git-result! dir "-c" (str "user.name=" committer) "-c" "user.email="
                   "commit" "--author" (str author " <>")
                   "-m" subject "-m" body)
      (git-output dir "rev-parse" "HEAD")))

  (show-commit [_ commit]
    (let [full (:out (git-result! root "show" "--format=fuller" commit))]
      (if (<= (alength (.getBytes ^String full "UTF-8")) SHOW-COMMIT-LIMIT-BYTES)
        full
        (md (str "The full diff exceeds " SHOW-COMMIT-LIMIT-BYTES " bytes, so only the commit stat follows."
                 " Run `git show " commit " -- <path>` to see one file's changes.")
            (:out (git-result! root "show" "--format=fuller" "--stat" commit))))))

  (advance-task! [this task-id expected new-tip]
    (let [result (git-result root "update-ref" (branch-ref task-id)
                             new-tip expected)]
      (if (zero? (:exit result))
        {:outcome :advanced :commit new-tip}
        {:outcome :stale :actual (task-tip this task-id)}))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; CLI metadata and dispatch

(def CommandArgument
  [:map
   [:name :string]
   [:optional {:optional true} :boolean]])

(def CommandMetadata
  [:map
   [:command :string]
   [:arguments [:vector CommandArgument]]
   [:doc :string]])

(defn die! [& lines]
  (throw (ex-info (str/join "\n" lines) {:user-error true})))

(defn make-runtime []
  (let [{:keys [exit out]} (sh "git" "rev-parse" "--show-toplevel")]
    (when-not (zero? exit)
      (die! "Not inside a git repository."
            (str COMMAND-NAME " manages tasks per repository; run it from within one.")))
    (let [root (str/trim out)]
      (assert-schema! Runtime
                      {:repo-root     root
                       :tasktron-root (str (fs/path root TASKTRON-DIRECTORY))
                       :vcs           (->GitVcs root)}))))

(def command-vars
  [#'new-cmd #'refine-cmd #'plan-cmd #'review-plan-cmd #'approve-cmd
   #'run-cmd #'retry-cmd #'status-cmd #'validate-cmd #'self-test-cmd])

(defn command-spec [command-var]
  (assert-schema! CommandMetadata
                  (select-keys (meta command-var)
                               [:command :arguments :doc])))

(defn command-named [command-name]
  (first (filter #(= command-name (:command (command-spec %))) command-vars)))

(defn argument-token [{:keys [name optional]}]
  (let [token (str "<" name ">")]
    (if optional (str "[" token "]") token)))

(defn synopsis [command-var]
  (let [{:keys [command arguments]} (command-spec command-var)]
    (str COMMAND-NAME " " command
         (when (seq arguments)
           (str " " (str/join " " (map argument-token arguments)))))))

(defn valid-argument-count? [command-var args]
  (let [arguments (:arguments (command-spec command-var))
        minimum   (count (remove :optional arguments))]
    (<= minimum (count args) (count arguments))))

(defn dispatch-command! [command-name args]
  (if-let [command-var (command-named command-name)]
    (do
      (when-not (valid-argument-count? command-var args)
        (die! (str "Usage: " (synopsis command-var))))
      (@command-var (make-runtime) args))
    (die! (str "Unknown command: " command-name "\n\n" (usage)))))

(defn usage []
  (str "With no command, " COMMAND-NAME " runs the next authoring step.\n\n"
       (str/join
        (for [command-var command-vars]
          (let [{:keys [doc]} (command-spec command-var)]
            (format "%-42s%s\n" (synopsis command-var) doc))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; development tooling

(defn format-clj
  [clj-source]
  (cljfmt/reformat-string clj-source {:align-form-columns? true
                                      :align-map-columns?  true
                                      :extra-indents       {'asserting [[:block 1]]}}))

(def default-test-report t/report)

(defn readable-test-report [{:keys [type actual] :as event}]
  (if (= :error type)
    (t/with-test-out
      (t/inc-report-counter :error)
      (println "\nERROR in" (t/testing-vars-str event))
      (when-let [contexts (seq (t/testing-contexts-str))]
        (println contexts))
      (println (render-error actual)))
    (default-test-report event)))

(defn ^{:command   "self-test"
        :arguments []
        :doc       "format, lint, and run the inline tests"}
  self-test-cmd
  [_runtime _args]
  (let [me (str (fs/canonicalize *file*))]
    (let [before (slurp me)
          after  (format-clj before)]
      (when (not= before after)
        (spit me after)
        (println "formatted" (fs/file-name me))))
    (pods/load-pod 'clj-kondo/clj-kondo "2026.08.04")
    (let [lint!                        (requiring-resolve 'pod.borkdude.clj-kondo/run!)
          print!                       (requiring-resolve 'pod.borkdude.clj-kondo/print!)
          {:keys [summary] :as result} (lint! {:lint [me]})]
      (print! result)
      (when (pos? (+ (:error summary) (:warning summary)))
        (System/exit 1)))
    (let [{:keys [fail error]} (binding [t/report readable-test-report]
                                 (t/run-tests 'tasktron))]
      (System/exit (if (pos? (+ fail error)) 1 0)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; test support

(defmacro asserting
  "Bind a threaded value for assertions, then return it unchanged."
  [value binding & body]
  `(let [value#   ~value
         ~binding value#]
     ~@body
     value#))

(def TEST-REPO-ROOT "/repo")

(def test-task
  {:title    "T"
   :body     "D"
   :checks   []
   :subtasks [{:id :a :title "A" :dependencies [] :checks [] :body "A body"}
              {:id :b :title "B" :dependencies [:a] :checks [] :body "B body"}]})

(def TEST-NOW #inst "2026-01-01T00:00:00.000Z")

(defn seconds-after [seconds]
  (java.util.Date. (+ (.getTime TEST-NOW) (* seconds 1000))))

(def test-state (initial-state :t test-task "tip000" TEST-NOW))
(def test-runtime
  {:repo-root     TEST-REPO-ROOT
   :tasktron-root (str (fs/path TEST-REPO-ROOT TASKTRON-DIRECTORY))
   :vcs           :test-vcs})

(def test-agent-metadata
  {:harness :pi :session-id "00000000-0000-0000-0000-000000000001" :name "GPT-5.6 Sol"})

(def test-commit-context
  {:subject "A" :notes [] :sessions {}})

(def started-state
  (step test-state nil {:event-name :run-requested} TEST-NOW))

(def test-agent-event-names
  #{:implementation-finished :revision-finished :approved :feedback :amended})

(def test-summary-event-names
  #{:implementation-finished :revision-finished :amended :approved})

(defn with-test-agent [event]
  (cond-> event
    (test-agent-event-names (:event-name event))
    (assoc :agent test-agent-metadata)

    (test-summary-event-names (:event-name event))
    (assoc :summary "summary")))

(defn step-result [state event]
  (step state :a (with-test-agent event) TEST-NOW))

(defn approved-commit-id
  "The re-committed id the approval path stamps onto a reviewed commit."
  [commit]
  (str commit "-approved"))

(defn approved-subtask [state id commit]
  (-> state
      (step id (with-test-agent {:event-name :implementation-finished
                                 :commit     commit}) TEST-NOW)
      (step id {:event-name :check-passed} TEST-NOW)
      (step id (with-test-agent {:event-name :approved
                                 :commit     (approved-commit-id commit)}) TEST-NOW)))

(defn durable-history [events]
  (mapv #(assoc % :at TEST-NOW) events))

(defn approved-history [base commit]
  (durable-history
   [{:event-name :specified :body "body"}
    {:event-name :implementation-started :base base}
    (with-test-agent {:event-name :implementation-finished :commit commit})
    {:event-name :check-passed}
    (with-test-agent {:event-name :approved
                      :commit     (approved-commit-id commit)})]))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; domain and transition tests

(deftest readable-error-reporting-test
  (let [error    (try
                   (assert-schema! [:map [:source CommitId]] {:source nil})
                   (catch Exception exception exception))
        rendered (render-error error)
        counters (ref t/*initial-report-counters*)
        output   (with-out-str
                   (binding [t/*test-out*        *out*
                             t/*report-counters* counters]
                     (readable-test-report {:type   :error
                                            :actual error
                                            :file   "tasktron.clj"
                                            :line   1})))]
    (is (str/includes? rendered "Schema validation failed."))
    (is (str/includes? rendered ":source nil"))
    (is (str/includes? rendered "should be a string"))
    (is (str/includes? output "ERROR in"))
    (is (str/includes? output rendered))
    (is (= 1 (:error @counters)))
    (is (= "plain failure" (render-error (ex-info "plain failure" {}))))))

(deftest make-runtime-outside-git-repository-test
  (with-redefs [sh (constantly {:exit 128 :out "" :err "fatal: not a git repository"})]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Not inside a git repository"
                          (make-runtime)))))

(deftest prepare-worktree-detaches-reused-worktrees-test
  ;; An agent may leave a branch checked out in a reused worktree; a plain
  ;; reset --hard would drag that branch (possibly the task branch) along.
  (let [tmp   (fs/create-temp-dir {:prefix "tasktron-worktree-test-"})
        calls (atom [])
        note  (fn [_dir & args] (swap! calls conj (vec args)) {:exit 0 :out "" :err ""})]
    (try
      (with-redefs [git-result note git-result! note]
        (is (= (str tmp) (prepare-worktree! (->GitVcs "/repo") "abc123" (str tmp)))))
      (is (some #{["checkout" "--force" "--detach" "abc123"]} @calls))
      (is (not-any? #(= "reset" (first %)) @calls))
      (finally
        (fs/delete-tree tmp)))))

(defn recording-git
  "A git-result stub that records its arguments and answers with result."
  [calls result]
  (fn [_root & args] (swap! calls conj (vec args)) result))

(def WORKTREE-REMOVAL-FAILURE
  {:exit 128 :out "" :err "fatal: validation failed"})

(deftest remove-worktree-forces-removal-test
  ;; An agent can leave modifications behind, and git refuses to remove a
  ;; dirty worktree without --force.
  (let [calls (atom [])]
    (with-redefs [git-result  (recording-git calls {:exit 0 :out "" :err ""})
                  git-result! (recording-git calls {:exit 0 :out "" :err ""})]
      (remove-worktree! (->GitVcs "/repo") "/repo/.tasktron/t/worktrees/0"))
    (is (= [["worktree" "remove" "--force" "/repo/.tasktron/t/worktrees/0"]]
           @calls))))

(deftest remove-worktree-prunes-stale-registrations-test
  ;; A registration goes stale when a worktree's directory moves or its
  ;; administrative data disappears; pruning clears the record so a retry
  ;; can remove the directory that is still there.
  (let [tmp   (fs/create-temp-dir {:prefix "tasktron-worktree-test-"})
        calls (atom [])]
    (try
      (with-redefs [git-result  (recording-git calls WORKTREE-REMOVAL-FAILURE)
                    git-result! (recording-git calls {:exit 0 :out "" :err ""})]
        (remove-worktree! (->GitVcs "/repo") (str tmp)))
      (is (= [["worktree" "remove" "--force" (str tmp)]
              ["worktree" "prune"]
              ["worktree" "remove" "--force" (str tmp)]]
             @calls))
      (finally
        (fs/delete-tree tmp)))))

(deftest remove-worktree-accepts-absent-directories-test
  ;; Nothing remains to remove once pruning drops the registration of a
  ;; directory that is already gone.
  (let [calls (atom [])]
    (with-redefs [git-result  (recording-git calls WORKTREE-REMOVAL-FAILURE)
                  git-result! (fn [& _] (throw (ex-info "unexpected retry" {})))]
      (is (nil? (remove-worktree! (->GitVcs "/repo") "/repo/.tasktron/t/worktrees/gone"))))
    (is (= [["worktree" "remove" "--force" "/repo/.tasktron/t/worktrees/gone"]
            ["worktree" "prune"]]
           @calls))))

(deftest remove-worktree-propagates-repeated-failures-test
  (let [tmp (fs/create-temp-dir {:prefix "tasktron-worktree-test-"})]
    (try
      (with-redefs [git-result  (constantly WORKTREE-REMOVAL-FAILURE)
                    git-result! (fn [_root & _args]
                                  (throw (ex-info "git failed: validation failed"
                                                  WORKTREE-REMOVAL-FAILURE)))]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"git failed"
                              (remove-worktree! (->GitVcs "/repo") (str tmp)))))
      (finally
        (fs/delete-tree tmp)))))

(deftest show-commit-simplifies-large-diffs-test
  (let [vcs      (->GitVcs "/repo")
        big-diff (apply str (repeat 200001 "x"))
        fake-git (fn [_root & args]
                   {:exit 0
                    :out  (if (some #{"--stat"} (vec args)) "stat-output" big-diff)})]
    (with-redefs [git-result! (constantly {:exit 0 :out "small-diff"})]
      (is (= "small-diff" (show-commit vcs "abc123"))))
    (with-redefs [git-result! fake-git]
      (let [shown (show-commit vcs "abc123")]
        (is (str/includes? shown "stat-output"))
        (is (not (str/includes? shown "xxx")))
        (is (str/includes? shown "git show abc123"))))))

(deftest next-authoring-command-test
  (let [planned (str "# Add search\n\nAdd a search box.\n\n"
                     "## Subtasks\n\n### Add input\n\nAdd it.\n")]
    (is (= {:command "new" :reason "No draft exists"}
           (next-authoring-command nil)))
    (is (= {:command "refine" :reason "Draft does not parse"}
           (next-authoring-command :unparseable)))
    (is (= "refine"
           (:command (next-authoring-command (parse-task DRAFT-TEMPLATE)))))
    (is (= "plan"
           (:command (next-authoring-command
                      (parse-task "# Add search\n\nAdd a search box.\n")))))
    (is (= "review-plan"
           (:command (next-authoring-command (parse-task planned)))))
    (is (every? #(command-named (:command (next-authoring-command %)))
                [nil :unparseable
                 (parse-task DRAFT-TEMPLATE)
                 (parse-task "# Add search\n\nAdd a search box.\n")
                 (parse-task planned)]))))

(deftest authoring-prompt-test
  (is (nil? (authoring-prompt "p" DRAFT-TEMPLATE)))
  (let [contents "# Real task\n"
        composed (authoring-prompt "p" contents)]
    (is (str/includes? composed "p"))
    (is (str/includes? composed contents))))

(deftest schemas-and-stage-facts-test
  (is (m/validate SubtaskEvent {:event-name :check-passed}))
  (is (not (m/validate DurableSubtaskEvent {:event-name :check-passed})))
  (is (m/validate DurableSubtaskEvent {:event-name :check-passed :at TEST-NOW}))
  (is (m/validate Event {:event-name :check-passed}))
  (is (m/validate ControlEvent {:event-name :retry-requested}))
  (is (m/validate ControlEvent {:event-name :retry-requested :subtask :a}))
  (is (m/validate Event {:event-name :implementation-started :base "tip000"}))
  (is (every? #(m/validate AgentRole %) (keys role->agent)))
  (is (every? #(m/validate AgentConfig %) (vals role->agent)))
  (is (m/validate Event {:event-name :approved
                         :commit     "approved1"
                         :summary    "summary"
                         :agent      test-agent-metadata}))
  (is (not (m/validate Event {:event-name :approved :agent test-agent-metadata})))
  (is (m/validate Event {:event-name :amended
                         :commit     "source2"
                         :summary    "tidied"
                         :agent      test-agent-metadata}))
  (is (not (m/validate Event {:event-name :amended :commit "source2"})))
  (is (not (m/validate Event {:event-name :check-finished :exit 0})))
  (is (not (m/validate Event {:event-name :implementation-finished
                              :commit     "source1"})))
  (is (m/validate Event {:event-name :implementation-finished
                         :commit     "source1"
                         :summary    "implemented"
                         :agent      test-agent-metadata}))
  (is (m/validate Stage {:stage-name :pending}))
  (is (m/validate Stage {:stage-name :revising
                         :base       "tip000"
                         :commit     "source1"}))
  (is (not (m/validate Stage {:stage-name :implementing})))
  (is (not (m/validate Stage {:stage-name :blocked})))
  (is (= {:event-name :effect-failed :summary "boom"}
         (effect-failure-event (ex-info "boom" {}))))
  (is (= #{:check-passed :check-failed}
         (get-in effect->definition [:check :results])))
  (is (= :pending (:stage-name (subtask-stage test-state :a))))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"no subtask routing context"
       (step started-state
             {:event-name :implementation-finished
              :commit     "source1"
              :summary    "implemented"
              :agent      test-agent-metadata})))
  (-> started-state
      (asserting state
                 (is (= :implementing (:stage-name (subtask-stage state :a))))
                 (is (match? {:tip      "tip000"
                              :subtasks {:a {:history
                                             (mc/via last
                                                     {:event-name :implementation-started
                                                      :base       "tip000"})}}}
                             state)))
      (step-result {:event-name :implementation-finished
                    :commit     "source1"})
      (asserting state
                 (is (= :checking (:stage-name (subtask-stage state :a))))
                 (is (= "source1" (:commit (subtask-stage state :a)))))
      (step-result {:event-name :check-failed
                    :command    "check"
                    :exit       1
                    :output     "broken"})
      (asserting state
                 (is (= :revising (:stage-name (subtask-stage state :a))))
                 (is (match? {:subtasks {:a {:history
                                             (mc/via last
                                                     {:event-name :check-failed
                                                      :command    "check"
                                                      :exit       1
                                                      :output     "broken"})}}}
                             state)))))

(deftest render-commit-test
  (let [context {:subject  "Lay the groundwork in db.clj"
                 :author   "Claude Fable 5"
                 :summary  "Add the schema var."
                 :notes    ["Resolved replaying abc onto def."]
                 :sessions {:implementation "claude-code 1111"
                            :review         "claude-code 2222"}}]
    (is (m/validate CommitContext context))
    (is (= {:subject   "Lay the groundwork in db.clj"
            :author    "Claude Fable 5"
            :committer "GPT-5.6 Sol"
            :body      (str "Reviewed summary.\n\n"
                            "Resolved replaying abc onto def.\n\n"
                            "Second note.\n\n"
                            "Implementation-session: claude-code 1111\n"
                            "Review-session: pi 00000000-0000-0000-0000-000000000001")}
           (render-commit context {:role    :review
                                   :agent   test-agent-metadata
                                   :summary "Reviewed summary."
                                   :note    "Second note."})))
    (is (= {:subject   "First"
            :author    "GPT-5.6 Sol"
            :committer "GPT-5.6 Sol"
            :body      (str "Did the thing.\n\n"
                            "Implementation-session: pi 00000000-0000-0000-0000-000000000001")}
           (render-commit {:subject "First" :notes [] :sessions {}}
                          {:role    :implementation
                           :agent   test-agent-metadata
                           :summary "Did the thing."})))
    (is (= {:subject   "Lay the groundwork in db.clj"
            :author    "Claude Fable 5"
            :committer "Claude Fable 5"
            :body      (str "Add the schema var.\n\n"
                            "Resolved replaying abc onto def.\n\n"
                            "Implementation-session: claude-code 1111\n"
                            "Review-session: claude-code 2222")}
           (render-commit context {})))))

(deftest commit-context-projection-test
  (let [implementer  {:harness :claude-code :session-id "11111111-aaaa" :name "Claude Fable 5"}
        reviewer     {:harness :claude-code :session-id "22222222-bbbb" :name "Claude Opus 5"}
        implementer2 {:harness :pi :session-id "33333333-cccc" :name "GPT-5.6 Sol"}
        amended      (-> started-state
                         (step :a {:event-name :implementation-finished
                                   :commit     "source1"
                                   :summary    "First draft."
                                   :agent      implementer} TEST-NOW)
                         (step :a {:event-name :check-passed} TEST-NOW)
                         (step :a {:event-name :amended
                                   :commit     "source2"
                                   :summary    "Reviewed summary."
                                   :agent      reviewer} TEST-NOW))
        resumed      (-> amended
                         (step :a {:event-name :blocked :summary "Stuck."} TEST-NOW)
                         (step nil {:event-name :retry-requested :subtask :a} TEST-NOW))]
    (is (= {:subject  "A"
            :author   "Claude Fable 5"
            :summary  "Reviewed summary."
            :notes    []
            :sessions {:implementation "claude-code 11111111-aaaa"
                       :review         "claude-code 22222222-bbbb"}}
           (commit-context amended :a)))
    (is (= (commit-context amended :a)
           (commit-context resumed :a)))
    (is (= {:subject  "A"
            :author   "GPT-5.6 Sol"
            :summary  "Second draft."
            :notes    []
            :sessions {:implementation "pi 33333333-cccc"
                       :review         "claude-code 22222222-bbbb"}}
           (-> resumed
               (step :a {:event-name :check-failed
                         :command    "check"
                         :exit       1
                         :output     "broken"} TEST-NOW)
               (step :a {:event-name :revision-finished
                         :commit     "source3"
                         :summary    "Second draft."
                         :agent      implementer2} TEST-NOW)
               (commit-context :a))))))

(deftest feedback-directly-revises-test
  (-> started-state
      (step-result {:event-name :implementation-finished
                    :commit     "source1"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :feedback
                    :feedback   [{:title "Fix" :body "it"}]})
      (asserting state
                 (is (= :revising (:stage-name (subtask-stage state :a))))
                 (is (match? {:subtasks {:a {:history
                                             (mc/via last
                                                     {:event-name :feedback
                                                      :feedback   [{:title "Fix"
                                                                    :body  "it"}]})}}}
                             state)))))

(deftest reviewer-amendment-checks-then-integrates-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :amended :commit "source2"})
      (asserting state
                 (is (= {:stage-name :checking-amendment :base "tip000" :commit "source2"}
                        (subtask-stage state :a)))
                 (is (zero? (revision-trigger-count state :a)))
                 (is (= "0+1" (subtask-rework state :a)))
                 (is (= [{:effect-name :check :subtask :a :commit "source2" :checks []}]
                        (effects-for-state state))))
      (step-result {:event-name :check-passed})
      (asserting state
                 (is (= {:stage-name :awaiting-integration
                         :base       "tip000"
                         :commit     "source2"}
                        (subtask-stage state :a))))))

(deftest failed-amendment-check-revises-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :amended :commit "source2"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "broken"})
      (asserting state
                 (is (= :revising (:stage-name (subtask-stage state :a))))
                 (is (= 1 (revision-trigger-count state :a)))
                 (is (= "1+1" (subtask-rework state :a))))
      (step-result {:event-name :revision-finished :commit "source3"})
      (step-result {:event-name :check-passed})
      (asserting state
                 (is (= :reviewing (:stage-name (subtask-stage state :a)))))))

(deftest amendment-spends-no-revision-budget-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "one"})
      (step-result {:event-name :revision-finished :commit "source2"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "two"})
      (step-result {:event-name :revision-finished :commit "source3"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "three"})
      (step-result {:event-name :revision-finished :commit "source4"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :amended :commit "source5"})
      (asserting state
                 (is (= 3 (revision-trigger-count state :a)))
                 (is (= "3+1" (subtask-rework state :a)))
                 (is (= :checking-amendment (:stage-name (subtask-stage state :a))))
                 (is (= [{:effect-name :check :subtask :a :commit "source5" :checks []}]
                        (effects-for-state state))))))

(deftest shared-revision-budget-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "one"})
      (asserting state
                 (is (= 1 (revision-trigger-count state :a)))
                 (is (= :revise (:effect-name (first (effects-for-state state))))))
      (step-result {:event-name :revision-finished :commit "source2"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :feedback
                    :feedback   [{:title "two" :body "two"}]})
      (asserting state
                 (is (= 2 (revision-trigger-count state :a))))
      (step-result {:event-name :revision-finished :commit "source3"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "three"})
      (asserting state
                 (is (= 3 (revision-trigger-count state :a))))
      (step-result {:event-name :revision-finished :commit "source4"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :feedback
                    :feedback   [{:title "four" :body "four"}]})
      (asserting state
                 (is (= :blocked (:stage-name (subtask-stage state :a))))
                 (is (= [:feedback :blocked]
                        (mapv :event-name (take-last 2 (history state :a)))))
                 (is (= {:event-name :blocked
                         :summary    "Revision limit reached."}
                        (dissoc (last (history state :a)) :at)))
                 (is (empty? (effects-for-state state))))))

(deftest reset-restores-revision-budget-test
  (-> started-state
      (step-result {:event-name :blocked :summary "no"})
      (asserting state
                 (is (= :blocked (:stage-name (subtask-stage state :a)))))
      (step {:event-name :retry-requested :subtask :a})
      (asserting state
                 (is (= :implementing (:stage-name (subtask-stage state :a))))
                 (is (zero? (revision-trigger-count state :a)))
                 (is (= [:blocked :reset]
                        (mapv :event-name (take-last 2 (history state :a))))))))

(deftest retry-all-blocked-subtasks-test
  (let [task    (assoc test-task :subtasks
                       (mapv #(assoc % :dependencies []) (:subtasks test-task)))
        started (step (initial-state :t task "tip000")
                      {:event-name :run-requested})
        blocked (-> started
                    (step :a {:event-name :blocked :summary "a stopped"})
                    (step :b {:event-name :blocked :summary "b stopped"}))
        retried (step blocked {:event-name :retry-requested})]
    (is (every? #(= :implementing
                    (:stage-name (subtask-stage retried %)))
                [:a :b]))
    (is (every? #(= [:blocked :reset]
                    (mapv :event-name (take-last 2 (history retried %))))
                [:a :b]))))

(deftest reset-resumes-the-blocked-stage-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :blocked :summary "review crashed"})
      (asserting state
                 (is (= :blocked (:stage-name (subtask-stage state :a)))))
      (step {:event-name :retry-requested :subtask :a})
      (asserting state
                 (is (= {:stage-name :reviewing :base "tip000" :commit "source1"}
                        (subtask-stage state :a)))
                 (is (= [:blocked :reset]
                        (mapv :event-name (take-last 2 (history state :a)))))
                 (is (= :review (:effect-name (first (effects-for-state state)))))
                 (is (= "source1" (:commit (first (effects-for-state state))))))))

(deftest reset-resumes-revising-with-its-trigger-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "broken"})
      (step-result {:event-name :blocked :summary "reviser crashed"})
      (step {:event-name :retry-requested :subtask :a})
      (asserting state
                 (is (= :revising (:stage-name (subtask-stage state :a))))
                 (is (= :check-failed (:event-name (immediate-revision-trigger state :a))))
                 (is (= :revise (:effect-name (first (effects-for-state state)))))
                 (is (str/includes? (:instructions (first (effects-for-state state)))
                                    "broken")))))

(deftest timestamped-history-events-test
  (let [at    (seconds-after 10)
        state (step test-state nil {:event-name :run-requested} at)]
    (is (= [TEST-NOW at] (mapv :at (history state :a))))))

(deftest timing-projections-test
  (let [state (-> test-state
                  (step nil {:event-name :run-requested} (seconds-after 10))
                  (step :a (with-test-agent
                             {:event-name :implementation-finished :commit "source1"})
                        (seconds-after 20))
                  (step :a {:event-name :check-failed :command "check" :exit 1 :output "broken"}
                        (seconds-after 25))
                  (step :a (with-test-agent
                             {:event-name :revision-finished :commit "source2"})
                        (seconds-after 40)))]
    (is (= (seconds-after 40) (stage-entered-at state :a)))
    (is (= 10000 (current-stage-elapsed-ms state :a (seconds-after 50))))
    (is (= 40000 (active-elapsed-ms state :a (seconds-after 50) true)))
    (is (= 30000 (active-elapsed-ms state :a (seconds-after 50) false)))
    (is (= "1" (subtask-rework state :a))))
  (let [resumed (-> test-state
                    (step nil {:event-name :run-requested} (seconds-after 10))
                    (assoc :run-started-at (seconds-after 40))
                    (step :a (with-test-agent
                               {:event-name :implementation-finished :commit "source1"})
                          (seconds-after 50)))]
    (is (= 10000 (active-elapsed-ms resumed :a (seconds-after 50) false)))))

(deftest subtask-rework-test
  (is (nil? (subtask-rework started-state :b)))
  (is (= "0" (subtask-rework started-state :a)))
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "one"})
      (asserting state
                 (is (= "1" (subtask-rework state :a))))
      (step-result {:event-name :revision-finished :commit "source2"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "two"})
      (step-result {:event-name :revision-finished :commit "source3"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "three"})
      (step-result {:event-name :revision-finished :commit "source4"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "four"})
      (asserting state
                 (is (= :blocked (:stage-name (subtask-stage state :a))))
                 (is (= "3" (subtask-rework state :a))))
      (step {:event-name :retry-requested :subtask :a})
      (asserting state
        ;; The retry resumes :revising with a fresh revision budget and the
        ;; fourth check failure as the pending trigger.
                 (is (= :revising (:stage-name (subtask-stage state :a))))
                 (is (= "3.0" (subtask-rework state :a))))
      (step-result {:event-name :revision-finished :commit "source5"})
      (step-result {:event-name :check-failed :command "check" :exit 1 :output "five"})
      (step-result {:event-name :revision-finished :commit "source6"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :amended :commit "source7"})
      (asserting state
        ;; The amendment shows beside the cycle's revisions without spending
        ;; the budget that caps them.
                 (is (= "3.1+1" (subtask-rework state :a))))))

(deftest immediate-trigger-diagnostics-test
  (-> started-state
      (asserting state
                 (is (nil? (immediate-revision-trigger state :a)))
                 (is (string? (build-implementation-instructions state :a)))
                 (is (str/includes? (build-implementation-instructions state :a)
                                    SUMMARY-CONTEXT))
                 (is (str/includes? (build-review-instructions state :a)
                                    SUMMARY-CONTEXT))
                 (is (str/includes? (build-rebase-resolution-instructions state :a "conflict")
                                    SUMMARY-CONTEXT))
                 (is (str/includes? (build-rebase-resolution-instructions state :a "conflict")
                                    "which side of each conflict survived")))
      (step-result {:event-name :implementation-finished :commit "source1"})
      (step-result {:event-name :check-failed
                    :command    "bb test.clj"
                    :exit       7
                    :output     "only-this-check"})
      (asserting state
                 (is (str/includes? (build-implementation-instructions state :a)
                                    "only-this-check"))
                 (is (str/includes? (build-implementation-instructions state :a)
                                    "bb test.clj")))
      (step-result {:event-name :revision-finished :commit "source2"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :feedback
                    :feedback   [{:title "new" :body "only-this-feedback"}]})
      (asserting state
                 (let [instructions (build-implementation-instructions state :a)]
                   (is (not (str/includes? instructions "only-this-check")))
                   (is (str/includes? instructions "only-this-feedback"))))
      (step-result {:event-name :revision-finished :commit "source3"})
      (step-result {:event-name :check-passed})
      (step-result {:event-name :feedback
                    :feedback   [{:title "later" :body "latest-only"}]})
      (asserting state
                 (let [instructions (build-implementation-instructions state :a)]
                   (is (not (str/includes? instructions "only-this-feedback")))
                   (is (str/includes? instructions "latest-only"))))))

(deftest source-artifact-survives-diagnostic-facts-test
  (-> started-state
      (step-result {:event-name :implementation-finished :commit "source1"})
      (asserting state
                 (is (= "source1" (:commit (subtask-stage state :a)))))
      (step-result {:event-name :check-passed})
      (asserting state
                 (is (= "source1" (:commit (subtask-stage state :a))))
                 (is (not (contains? (last (history state :a)) :commit))))
      (step-result {:event-name :feedback
                    :feedback   [{:title "x" :body "y"}]})
      (asserting state
                 (is (= "source1" (:commit (subtask-stage state :a))))
                 (is (not (contains? (last (history state :a)) :commit))))
      (step-result {:event-name :revision-finished :commit "source2"})
      (asserting state
                 (is (= "source2" (:commit (subtask-stage state :a)))))))

(deftest illegal-transition-test
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Illegal subtask transition"
                        (append-event test-state :a
                                      {:event-name :branch-advanced
                                       :commit     "wrong00"})))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Illegal subtask transition"
                        (step-result test-state
                                     {:event-name :check-passed}))))

(deftest complete-blocked-actionable-test
  (let [empty-state (initial-state :empty (assoc test-task :subtasks []) "tip000")
        stopped     (step-result started-state
                                 {:event-name :effect-failed
                                  :summary    "boom"})]
    (is (complete? empty-state))
    (is (= :complete (outcome empty-state)))
    (is (actionable? test-state))
    (is (= {:event-name :blocked :summary "boom"}
           (dissoc (last (history stopped :a)) :at)))
    (is (blocked? stopped))))

(deftest test-plan-note-test
  (let [tmp (fs/create-temp-dir {:prefix "tasktron-test-plan-test-"})]
    (try
      (is (nil? (test-plan-note (str tmp) :complete)))
      (spit (str (fs/path tmp TEST-PLAN-FILENAME)) "# Manual test plan: T\n")
      (let [note (test-plan-note (str tmp) :complete)]
        (is (str/starts-with? note "Review manual test plan: "))
        (is (str/ends-with? note "test-plan.md")))
      (is (nil? (test-plan-note (str tmp) :blocked)))
      (finally
        (fs/delete-tree tmp)))))

(deftest approved-task-change-stub-test
  (is (= test-state (reconcile-task test-state test-task)))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo
                        #"Changing an approved task is not implemented"
                        (reconcile-task test-state
                                        (assoc test-task :body "changed")))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; scheduling and integration tests

(deftest run-loop-routes-effect-results-test
  (let [seen    (atom [])
        cleanup (atom [])
        lock    (reify java.io.Closeable
                  (close [_] (swap! cleanup conj :lock)))]
    (with-redefs [clojure.core/slurp     (constantly "")
                  parse-task             (constantly test-task)
                  save!                  (fn [_dir state] state)
                  acquire-task-lock!     (constantly lock)
                  make-progress-reporter (constantly (fn [_state _at]))
                  terminate-processes!   (fn [_] (swap! cleanup conj :processes))
                  prepare-worktree!      (fn [_vcs _commit dir] (str dir))
                  perform!               (fn [_runtime _worktree effect]
                                           (swap! seen conj effect)
                                           {:event-name :blocked :summary "cannot"})]
      (let [final (run! (task-runtime test-runtime "/task" test-state)
                        test-state {:event-name :run-requested})]
        (is (= :blocked (:stage-name (subtask-stage final :a))))
        (is (inst? (:run-started-at final)))
        (is (= [:a] (mapv :subtask @seen)))
        (is (= [:processes :processes :lock] @cleanup))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; archival tests

(def completed-state
  (initial-state :t (assoc test-task :subtasks []) "tip000" TEST-NOW))

(defn archive-tree!
  "A temporary repository holding one live task with every run artifact."
  [task-id-str]
  (let [root (fs/create-temp-dir {:prefix "tasktron-archive-test-"})
        dir  (fs/path root TASKTRON-DIRECTORY task-id-str)]
    (doseq [slot ["0" "1"]]
      (fs/create-dirs (fs/path dir WORKTREES-DIRECTORY slot)))
    (spit (str (fs/path dir TASK-FILENAME)) "# T\n")
    (spit (str (fs/path dir TEST-PLAN-FILENAME)) "# Manual test plan: T\n")
    (spit (str (fs/path dir AGENT-LOG-FILENAME)) "agent output\n")
    (spit (str (fs/path dir RUN-LOCK-FILENAME)) "")
    (save! (str dir) test-state)
    {:root root :dir dir}))

(defn archive-runtime [root vcs]
  {:repo-root     (str root)
   :tasktron-root (str (fs/path root TASKTRON-DIRECTORY))
   :vcs           vcs})

(defn fake-vcs
  "A VCS whose named overrides answer test calls; every other call fails."
  [overrides]
  (let [answer (fn [method & args]
                 (if-let [override (get overrides method)]
                   (apply override args)
                   (throw (ex-info (str "Unexpected VCS call `" method "`.")
                                   {:arguments (vec args)}))))]
    (reify IVcs
      (task-tip [_ task-id] (answer :task-tip task-id))
      (create-task! [_ task-id] (answer :create-task! task-id))
      (task-target [_ task-id] (answer :task-target task-id))
      (prepare-worktree! [_ commit dir] (answer :prepare-worktree! commit dir))
      (remove-worktree! [_ dir] (answer :remove-worktree! dir))
      (apply-commit! [_ dir commit] (answer :apply-commit! dir commit))
      (commit-worktree! [_ dir base message]
        (answer :commit-worktree! dir base message))
      (show-commit [_ commit] (answer :show-commit commit))
      (advance-task! [_ task-id expected new-tip]
        (answer :advance-task! task-id expected new-tip)))))

(defn deleting-vcs
  "A VCS that records the worktrees it removes and deletes their directories."
  [removed]
  (fake-vcs {:remove-worktree! (fn [dir]
                                 (swap! removed conj (fs/file-name dir))
                                 (fs/delete-tree dir))}))

(deftest archive-retains-artifacts-and-drops-run-data-test
  (let [{:keys [root dir]} (archive-tree! "t")
        removed            (atom [])
        runtime            (archive-runtime root (deleting-vcs removed))]
    (try
      (let [archived (archive-task! runtime dir)]
        (is (= ["0" "1"] @removed))
        (is (= (str (fs/path root TASKTRON-DIRECTORY COMPLETED-DIRECTORY "t"))
               (str archived)))
        (is (not (fs/exists? dir)))
        (doseq [artifact [TASK-FILENAME STATE-FILENAME TEST-PLAN-FILENAME
                          AGENT-LOG-FILENAME]]
          (is (fs/exists? (fs/path archived artifact))))
        (is (not (fs/exists? (fs/path archived RUN-LOCK-FILENAME))))
        (is (not (fs/exists? (fs/path archived WORKTREES-DIRECTORY))))
        (is (empty? (live-task-dirs runtime)))
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"No approved task"
                              (resolve-task-dir runtime nil))))
      (finally
        (fs/delete-tree root)))))

(deftest finalization-archives-only-complete-runs-test
  (let [{:keys [root dir]} (archive-tree! "t")
        removed            (atom [])
        runtime            (archive-runtime root (deleting-vcs removed))]
    (try
      (with-redefs [run! (fn [_runtime _state _event] started-state)]
        (let [{:keys [state task-dir]}
              (run-and-finalize! runtime dir test-state
                                 {:event-name :run-requested})]
          (is (= started-state state))
          (is (= (str dir) task-dir))
          (is (empty? @removed))
          (is (fs/exists? (fs/path dir RUN-LOCK-FILENAME)))
          (is (fs/directory? (fs/path dir WORKTREES-DIRECTORY)))))
      (with-redefs [run! (fn [_runtime _state _event] completed-state)]
        (let [{:keys [state task-dir]}
              (run-and-finalize! runtime dir test-state
                                 {:event-name :run-requested})]
          (is (complete? state))
          (is (= (str (fs/path root TASKTRON-DIRECTORY COMPLETED-DIRECTORY "t"))
                 task-dir))
          (is (fs/exists? (fs/path task-dir STATE-FILENAME)))))
      (finally
        (fs/delete-tree root)))))

(deftest archive-rejects-an-existing-destination-test
  ;; Rejection precedes cleanup so a name clash costs no worktrees.
  (let [{:keys [root dir]} (archive-tree! "t")
        removed            (atom [])
        runtime            (archive-runtime root (deleting-vcs removed))]
    (try
      (fs/create-dirs (fs/path root TASKTRON-DIRECTORY COMPLETED-DIRECTORY "t"))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"already archived"
                            (archive-task! runtime dir)))
      (is (empty? @removed))
      (is (fs/exists? (fs/path dir STATE-FILENAME)))
      (is (fs/exists? (fs/path dir RUN-LOCK-FILENAME)))
      (is (fs/directory? (fs/path dir WORKTREES-DIRECTORY "0")))
      (finally
        (fs/delete-tree root)))))

(deftest archive-survives-partial-cleanup-test
  ;; A failed removal keeps the task live, and a later attempt finishes the
  ;; cleanup that the first attempt started.
  (let [{:keys [root dir]} (archive-tree! "t")
        failed?            (atom false)
        vcs                (fake-vcs
                            {:remove-worktree!
                             (fn [worktree]
                               (when (and (= "1" (fs/file-name worktree))
                                          (not @failed?))
                                 (reset! failed? true)
                                 (throw (ex-info "worktree removal failed" {})))
                               (fs/delete-tree worktree))})
        runtime            (archive-runtime root vcs)
        destination        (fs/path root TASKTRON-DIRECTORY COMPLETED-DIRECTORY "t")]
    (try
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"worktree removal failed"
                            (archive-task! runtime dir)))
      (is (fs/exists? (fs/path dir STATE-FILENAME)))
      (is (not (fs/exists? destination)))
      (is (not (fs/exists? (fs/path dir WORKTREES-DIRECTORY "0"))))
      (is (= [dir] (live-task-dirs runtime)))
      (is (= (str destination) (str (archive-task! runtime dir))))
      (is (fs/exists? (fs/path destination STATE-FILENAME)))
      (is (not (fs/exists? (fs/path destination WORKTREES-DIRECTORY))))
      (finally
        (fs/delete-tree root)))))

(deftest archive-move-failure-keeps-the-task-live-test
  (let [{:keys [root dir]} (archive-tree! "t")
        removed            (atom [])
        runtime            (archive-runtime root (deleting-vcs removed))]
    (try
      (with-redefs [fs/move (fn [& _] (throw (ex-info "move failed" {})))]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"move failed"
                              (archive-task! runtime dir))))
      (is (fs/exists? (fs/path dir STATE-FILENAME)))
      (is (= [dir] (live-task-dirs runtime)))
      (is (not (fs/exists? (fs/path root TASKTRON-DIRECTORY COMPLETED-DIRECTORY "t"))))
      (finally
        (fs/delete-tree root)))))

(deftest completion-message-points-at-the-archive-test
  (let [{:keys [root dir]} (archive-tree! "t")
        removed            (atom [])
        runtime            (archive-runtime root (deleting-vcs removed))]
    (try
      (with-redefs [run! (fn [_runtime _state _event] completed-state)]
        (let [output (with-out-str (run-cmd runtime ["t"]))]
          (is (str/includes? output "t: complete"))
          (is (str/includes? output (str COMPLETED-DIRECTORY "/t/"
                                         TEST-PLAN-FILENAME)))
          (is (not (fs/exists? dir)))))
      (finally
        (fs/delete-tree root)))))

(deftest completing-commands-share-finalization-test
  (let [{:keys [root dir]} (archive-tree! "t")
        finalized          (atom [])
        vcs                (fake-vcs {:task-tip     (constantly nil)
                                      :create-task! (constantly "tip000")
                                      :task-target  name})
        runtime            (archive-runtime root vcs)]
    (try
      (fs/create-dirs (wip-dir runtime))
      (spit (str (wip-md runtime))
            "# Second task\n\nDesign.\n\n## Subtasks\n\n### A\n\nA body.\n")
      (with-redefs [run-and-finalize!
                    (fn [_runtime task-dir _state _event]
                      (swap! finalized conj (str task-dir))
                      {:state completed-state :task-dir "/archived"})]
        (with-out-str
          (approve-cmd runtime [])
          (run-cmd runtime ["t"])
          (retry-cmd runtime ["t" "a"])))
      (is (= [(str (fs/path root TASKTRON-DIRECTORY "second-task"))
              (str dir)
              (str dir)]
             @finalized))
      (finally
        (fs/delete-tree root)))))

(deftest approval-awaits-direct-integration-test
  (-> started-state
      (approved-subtask :a "source1")
      (asserting state
        ;; The branch advances to the approved commit, not the reviewed one.
                 (is (= {:stage-name :awaiting-integration
                         :base       "tip000"
                         :commit     "source1-approved"}
                        (subtask-stage state :a)))
                 (is (= {:event-name :approved
                         :commit     "source1-approved"
                         :summary    "summary"
                         :agent      test-agent-metadata}
                        (dissoc (last (history state :a)) :at)))
                 (is (= [{:effect-name :advance-branch
                          :subtask     :a
                          :expected    "tip000"
                          :new-tip     "source1-approved"}]
                        (effects-for-state state))))))

(deftest next-integration-prefers-current-base-test
  (-> test-state
      (assoc :tip "tip111")
      (assoc-in [:subtasks :a :history]
                (approved-history "tip000" "sourceA"))
      (assoc-in [:subtasks :b :history]
                (approved-history "tip111" "sourceB"))
      schedule-transition
      (asserting state
                 (is (= :awaiting-integration (:stage-name (subtask-stage state :a))))
                 (is (= :awaiting-integration (:stage-name (subtask-stage state :b))))
                 (is (= :b (next-integration-id state)))
                 (is (= [:b] (mapv :subtask (effects-for-state state)))))))

(deftest next-integration-uses-document-order-test
  (-> test-state
      (assoc :tip "tip111")
      (assoc-in [:subtasks :a :history]
                (approved-history "tip111" "sourceA"))
      (assoc-in [:subtasks :b :history]
                (approved-history "tip111" "sourceB"))
      (asserting state
                 (is (= :a (next-integration-id state)))
                 (is (= [:a] (mapv :subtask (effects-for-state state)))))))

(deftest stale-integration-rebases-checks-and-advances-test
  (-> (approved-subtask started-state :a "source1")
      (assoc :tip "tip111")
      schedule-transition
      (asserting state
                 (is (= :rebasing (:stage-name (subtask-stage state :a))))
                 (is (= {:event-name :rebase-started
                         :base       "tip111"
                         :source     "source1-approved"}
                        (dissoc (last (history state :a)) :at)))
                 (is (= [{:effect-name    :attempt-rebase
                          :subtask        :a
                          :base           "tip111"
                          :source         "source1-approved"
                          :commit-context {:subject  "A"
                                           :author   "GPT-5.6 Sol"
                                           :summary  "summary"
                                           :notes    []
                                           :sessions {:implementation "pi 00000000-0000-0000-0000-000000000001"
                                                      :review         "pi 00000000-0000-0000-0000-000000000001"}}}]
                        (effects-for-state state))))
      (step-result {:event-name :rebase-finished :commit "rebased1"})
      (asserting state
                 (is (= :checking-integration (:stage-name (subtask-stage state :a))))
                 (is (= [{:effect-name :check
                          :subtask     :a
                          :commit      "rebased1"
                          :checks      []}]
                        (effects-for-state state))))
      (step-result {:event-name :check-passed})
      (asserting state
                 (is (= :ready-to-advance (:stage-name (subtask-stage state :a))))
                 (is (= :a (integration-active-id state))))
      (step-result {:event-name :branch-advanced :commit "rebased1"})
      (asserting state
                 (is (match? {:tip      "rebased1"
                              :subtasks {:a {:history
                                             (mc/via last
                                                     {:event-name :branch-advanced
                                                      :commit     "rebased1"})}}}
                             state))
                 (is (= {:stage-name :integrated} (subtask-stage state :a))))))

(deftest rebase-conflict-switches-to-resolver-without-revision-test
  (-> (approved-subtask started-state :a "source1")
      (assoc :tip "tip111")
      schedule-transition
      (step-result {:event-name :rebase-conflicted :output "conflict-output"})
      (asserting state
                 (let [effect (first (effects-for-state state))]
                   (is (= {:stage-name :resolving-integration
                           :base       "tip111"
                           :source     "source1-approved"
                           :output     "conflict-output"}
                          (subtask-stage state :a)))
                   (is (zero? (revision-trigger-count state :a)))
                   (is (match? {:effect-name :resolve-rebase} effect))
                   (is (str/includes? (:instructions effect) "conflict-output"))))))

(deftest integration-check-failure-uses-shared-budget-and-diagnostics-test
  (-> (approved-subtask started-state :a "source1")
      (assoc :tip "tip111")
      schedule-transition
      (step-result {:event-name :rebase-finished :commit "rebased1"})
      (step-result {:event-name :check-failed
                    :command    "check"
                    :exit       2
                    :output     "integration-only"})
      (asserting state
                 (is (= :revising-integration (:stage-name (subtask-stage state :a))))
                 (is (= 1 (revision-trigger-count state :a)))
                 (is (= "rebased1" (:commit (subtask-stage state :a))))
                 (is (str/includes? (build-implementation-instructions state :a)
                                    "integration-only")))
      (step-result {:event-name :revision-finished :commit "rebased2"})
      (asserting state
                 (is (= :checking-integration (:stage-name (subtask-stage state :a))))
                 (is (= "rebased2" (:commit (subtask-stage state :a)))))))

(deftest active-integration-finishes-before-next-test
  (-> test-state
      (assoc :tip "tip111")
      (assoc-in [:subtasks :a :history]
                (into (approved-history "tip000" "sourceA")
                      (durable-history
                       [{:event-name :rebase-started
                         :base       "tip111"        :source "sourceA"}
                        {:event-name :rebase-finished :commit "rebasedA"}
                        {:event-name :check-passed}])))
      (assoc-in [:subtasks :b :history]
                (approved-history "tip111" "sourceB"))
      (asserting state
                 (is (= :a (integration-active-id state)))
                 (is (= :b (next-integration-id state)))
                 (is (= [:a] (mapv :subtask (effects-for-state state)))))))

(deftest source-work-remains-parallel-to-integration-test
  (let [state (-> test-state
                  (assoc-in [:subtasks :a :history]
                            (approved-history "tip000" "sourceA"))
                  (assoc-in [:subtasks :b :history]
                            (durable-history
                             [{:event-name :specified :body "body"}
                              {:event-name :implementation-started :base "tip000"}])))]
    (is (= [:a :b] (mapv :subtask (effects-for-state state))))))

(deftest check-effect-combines-task-and-subtask-checks-test
  (let [task  (-> test-task
                  (assoc :checks ["bb test.clj" "bb lint.clj"])
                  (assoc-in [:subtasks 0 :checks] ["bb test.clj --only a-test"]))
        state (-> (initial-state :t task "tip000" TEST-NOW)
                  (step nil {:event-name :run-requested} TEST-NOW)
                  (step-result {:event-name :implementation-finished
                                :commit     "source1"}))]
    (is (= [{:effect-name :check
             :subtask     :a
             :commit      "source1"
             :checks      ["bb test.clj" "bb lint.clj" "bb test.clj --only a-test"]}]
           (filterv #(= :check (:effect-name %)) (effects-for-state state))))))

(deftest branch-advance-validation-and-replay-test
  (let [state       (approved-subtask started-state :a "source1")
        effect      {:subtask :a :expected "tip000" :new-tip "source1-approved"}
        wrong-event {:event-name :branch-advanced :commit "wrong00"}]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"current integration commit"
                          (step-result state wrong-event)))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"current integration commit"
                          (subtask-stage
                           (update-in state [:subtasks :a :history] conj
                                      (assoc wrong-event :at TEST-NOW))
                           :a)))
    (is (= {:event-name :branch-advanced :commit "source1-approved"}
           (advance-result-event effect
                                 {:outcome :stale :actual "source1-approved"})))
    (is (= {:event-name :branch-stale :expected "tip000" :actual "other00"}
           (advance-result-event effect
                                 {:outcome :stale :actual "other00"})))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; effect handler tests

(deftest effects-return-events-directly-test
  (let [messages (atom [])]
    (with-redefs [prepare-effect-worktree! (constantly "/worktree")
                  invoke-agent!            (fn [_dir prompt _schema _agent _log]
                                             {:agent  test-agent-metadata
                                              :answer {:outcome (if (= "cannot" prompt)
                                                                  :blocked :done)
                                                       :summary prompt}})
                  commit-worktree!         (fn [_vcs _dir _base message]
                                             (swap! messages conj message)
                                             (when-not (str/starts-with? (:body message) "empty")
                                               "source1"))]
      (is (= {:event-name :implementation-finished
              :commit     "source1"
              :summary    "done"
              :agent      test-agent-metadata}
             (perform-implementation!
              test-runtime "/slot"
              {:effect-name    :implement          :subtask :a :base "tip000" :instructions "done"
               :commit-context test-commit-context})))
      (is (= {:subject   "A"
              :body      (str "done\n\n"
                              "Implementation-session: pi 00000000-0000-0000-0000-000000000001")
              :author    "GPT-5.6 Sol"
              :committer "GPT-5.6 Sol"}
             (first @messages)))
      (is (= {:event-name :revision-finished
              :commit     "source1"
              :summary    "done"
              :agent      test-agent-metadata}
             (perform-implementation!
              test-runtime "/slot"
              {:effect-name    :revise             :subtask      :a     :base "tip000"
               :previous       "source0"           :instructions "done"
               :commit-context test-commit-context})))
      (is (= {:event-name :blocked :summary "cannot" :agent test-agent-metadata}
             (perform-implementation!
              test-runtime "/slot"
              {:effect-name    :implement          :subtask :a :base "tip000" :instructions "cannot"
               :commit-context test-commit-context})))
      (is (= {:event-name :effect-failed
              :summary    "Agent reported done but produced no repository changes"
              :agent      test-agent-metadata}
             (perform! test-runtime "/slot"
                       {:effect-name    :implement          :subtask      :a
                        :base           "tip000"            :instructions "empty"
                        :commit-context test-commit-context})))))

  (with-redefs [prepare-effect-worktree! (constantly "/worktree")]
    (is (= {:event-name :check-passed}
           (perform-check! test-runtime "/slot"
                           {:subtask :a :commit "source1" :checks []}))))
  (let [commands (atom [])]
    (with-redefs [prepare-effect-worktree!  (constantly "/worktree")
                  run-process-with-timeout! (fn [argv _dir _timeout-ms]
                                              (swap! commands conj argv)
                                              (if (= "false" (last argv))
                                                {:exit 2 :out "out" :err "err"}
                                                {:exit 0 :out "" :err ""}))]
      (is (= {:event-name :check-passed}
             (perform-check! test-runtime "/slot"
                             {:subtask :a              :commit "source1"
                              :checks  ["true" "true"]})))
      (is (= {:event-name :check-failed :command "false" :exit 2 :output "outerr"}
             (perform-check! test-runtime "/slot"
                             {:subtask :a                                       :commit "source1"
                              :checks  ["true" "false" "skipped after failure"]})))
      (is (= [["sh" "-c" "true"] ["sh" "-c" "true"]
              ["sh" "-c" "true"] ["sh" "-c" "false"]]
             @commands))))

  (with-redefs [prepare-effect-worktree! (constantly "/worktree")
                show-commit              (constantly "diff")
                commit-worktree!         (fn [_vcs _dir _base message]
                                           (cond
                                             (str/starts-with? (:body message) "untouched") nil
                                             (str/starts-with? (:body message) "final") "approved1"
                                             :else "amended1"))
                invoke-agent!            (fn [_dir prompt _schema _agent _log]
                                           {:agent test-agent-metadata
                                            :answer
                                            (cond
                                              (str/starts-with? prompt "approve")
                                              {:outcome :approved :summary "final state"}

                                              (str/starts-with? prompt "amend")
                                              {:outcome :amended :summary "tidied"}

                                              (str/starts-with? prompt "noop")
                                              {:outcome :amended :summary "untouched"}

                                              (str/starts-with? prompt "weird")
                                              {:outcome :weird}

                                              :else
                                              {:outcome  :revision-requested
                                               :feedback [{:title "Fix" :body "it"}]})})]
    (let [approval (perform-review! test-runtime "/slot"
                                    {:subtask        :a                  :base         "tip000"
                                     :commit         "source1"           :instructions "approve"
                                     :commit-context test-commit-context})]
      ;; Approval re-commits the reviewed tree, so a distinct commit id results.
      (is (= {:event-name :approved
              :commit     "approved1"
              :summary    "final state"
              :agent      test-agent-metadata}
             approval))
      (is (not= "source1" (:commit approval))))
    (is (= {:event-name :amended :commit "amended1" :summary "tidied" :agent test-agent-metadata}
           (perform-review! test-runtime "/slot"
                            {:subtask        :a                  :base         "tip000"
                             :commit         "source1"           :instructions "amend"
                             :commit-context test-commit-context})))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo
                          #"amended but produced no repository changes"
                          (perform-review! test-runtime "/slot"
                                           {:subtask        :a                  :base         "tip000"
                                            :commit         "source1"           :instructions "noop"
                                            :commit-context test-commit-context})))
    (is (= {:event-name :feedback
            :feedback   [{:title "Fix" :body "it"}]
            :agent      test-agent-metadata}
           (perform-review! test-runtime "/slot"
                            {:subtask :a        :base         "tip000"
                             :commit  "source1" :instructions "review"})))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Unknown review outcome"
                          (perform-review! test-runtime "/slot"
                                           {:subtask :a        :base         "tip000"
                                            :commit  "source1" :instructions "weird"}))))

  (with-redefs [prepare-effect-worktree! (constantly "/worktree")
                apply-commit!            (fn [_vcs _dir source]
                                           (if (= "conflict1" source)
                                             {:outcome :conflict :output "conflict"}
                                             {:outcome :applied}))
                commit-worktree!         (constantly nil)]
    (is (= {:event-name :rebase-finished :commit "tip111"}
           (perform-attempt-rebase!
            test-runtime "/slot"
            {:subtask        :a                  :base "tip111" :source "source1"
             :commit-context test-commit-context})))
    (is (= {:event-name :rebase-conflicted :output "conflict"}
           (perform-attempt-rebase!
            test-runtime "/slot"
            {:subtask        :a                  :base "tip111" :source "conflict1"
             :commit-context test-commit-context}))))

  (with-redefs [prepare-effect-worktree! (constantly "/worktree")
                apply-commit!            (constantly {:outcome :conflict})
                show-commit              (constantly "diff")
                invoke-agent!            (constantly {:agent  test-agent-metadata
                                                      :answer {:outcome :blocked
                                                               :summary "cannot"}})]
    (is (= {:event-name :blocked :summary "cannot" :agent test-agent-metadata}
           (perform-resolve-rebase!
            test-runtime "/slot"
            {:subtask        :a                  :base "tip111" :source "source1"
             :instructions   "resolve"
             :commit-context test-commit-context}))))

  (let [messages (atom [])
        note     "Resolved replaying source1 onto tip111 — merge both call sites."]
    (with-redefs [prepare-effect-worktree! (constantly "/worktree")
                  apply-commit!            (constantly {:outcome :conflict})
                  show-commit              (constantly "diff")
                  invoke-agent!            (constantly {:agent  test-agent-metadata
                                                        :answer {:outcome :done
                                                                 :summary "merge both call sites."}})
                  commit-worktree!         (fn [_vcs _dir _base message]
                                             (swap! messages conj message)
                                             "resolved1")]
      (is (= {:event-name :rebase-finished
              :commit     "resolved1"
              :note       note
              :agent      test-agent-metadata}
             (perform-resolve-rebase!
              test-runtime "/slot"
              {:subtask        :a                                   :base "tip111" :source "source1"
               :instructions   "resolve"
               :commit-context (assoc test-commit-context
                                      :author "Claude Fable 5"
                                      :summary "Reviewed summary.")})))
      (is (= {:subject   "A"
              :body      (str "Reviewed summary.\n\n"
                              note "\n\n"
                              "Conflict-resolution-session: pi 00000000-0000-0000-0000-000000000001")
              :author    "Claude Fable 5"
              :committer "GPT-5.6 Sol"}
             (first @messages))))))

(deftest perform-check-runs-real-shell-commands-test
  (let [dir (fs/create-temp-dir {:prefix "tasktron-check-test-"})]
    (try
      (with-redefs [prepare-effect-worktree! (constantly (str dir))]
        (is (= {:event-name :check-passed}
               (perform-check! test-runtime "/slot"
                               {:subtask :a                                       :commit "c"
                                :checks  ["echo ready > marker" "test -f marker"]})))
        (is (= {:event-name :check-failed
                :command    "echo boom && exit 3"
                :exit       3
                :output     "boom\n"}
               (perform-check! test-runtime "/slot"
                               {:subtask :a                                   :commit "c"
                                :checks  ["echo boom && exit 3" "echo never"]}))))
      (finally
        (fs/delete-tree dir)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; agent harness tests

(deftest agent-command-and-answer-parsing-test
  (let [claude {:harness :claude-code :model "sonnet" :thinking :high :name "Claude Sonnet"}
        pi     {:harness :pi :model "openai-codex/gpt-5.6-sol" :thinking :high :name "GPT-5.6 Sol"}
        id     "00000000-0000-0000-0000-000000000001"]
    (is (= ["claude"
            "--allow-dangerously-skip-permissions"
            "--dangerously-skip-permissions"
            "--model" "sonnet"
            "--effort" "high"
            "--append-system-prompt" "system"
            "prompt"]
           (agent-command claude {:mode   :interactive
                                  :system "system"
                                  :prompt "prompt"})))
    (is (= ["pi"
            "--approve"
            "--model" "openai-codex/gpt-5.6-sol"
            "--thinking" "high"
            "--append-system-prompt" "system"
            "prompt"]
           (agent-command pi {:mode   :interactive
                              :system "system"
                              :prompt "prompt"})))
    ;; A nil prompt leaves the argv without a message so the session waits for
    ;; the user's first input.
    (is (= ["claude"
            "--allow-dangerously-skip-permissions"
            "--dangerously-skip-permissions"
            "--model" "sonnet"
            "--effort" "high"
            "--append-system-prompt" "system"]
           (agent-command claude {:mode   :interactive
                                  :system "system"
                                  :prompt nil})))
    (is (= ["pi"
            "--approve"
            "--model" "openai-codex/gpt-5.6-sol"
            "--thinking" "high"
            "--append-system-prompt" "system"]
           (agent-command pi {:mode   :interactive
                              :system "system"
                              :prompt nil})))
    ;; Headless argv carries no prompt: the prompt travels over stdin, because
    ;; execve caps each argv string at MAX_ARG_STRLEN and large diffs exceed it.
    (is (= ["claude"
            "-p"
            "--allow-dangerously-skip-permissions"
            "--dangerously-skip-permissions"
            "--model" "sonnet"
            "--effort" "high"
            "--session-id" id]
           (agent-command claude {:mode       :headless
                                  :session-id id})))
    (is (= ["claude"
            "-p"
            "--allow-dangerously-skip-permissions"
            "--dangerously-skip-permissions"
            "--model" "sonnet"
            "--effort" "high"
            "--append-system-prompt" "system"
            "--resume" id]
           (agent-command claude {:mode       :headless
                                  :system     "system"
                                  :session-id id
                                  :resume?    true})))
    (is (= ["pi"
            "-p"
            "--approve"
            "--model" "openai-codex/gpt-5.6-sol"
            "--thinking" "high"
            "--append-system-prompt" "system"
            "--session-id" id]
           (agent-command pi {:mode       :headless
                              :system     "system"
                              :session-id id
                              :resume?    true}))))
  (is (= {:outcome :done :summary "ok" :extra true}
         (parse-agent-answer ImplementationAnswer
                             "  {\"outcome\":\"done\",\"summary\":\"ok\",\"extra\":true}  ")))
  (is (= {:outcome :amended :summary "tidied"}
         (parse-agent-answer ReviewAnswer
                             "{\"outcome\":\"amended\",\"summary\":\"tidied\"}")))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"schema validation"
                        (parse-agent-answer ReviewAnswer
                                            "{\"outcome\":\"approved-with-feedback\",\"feedback\":[]}")))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"exactly one JSON value"
                        (parse-agent-answer ImplementationAnswer
                                            "{\"outcome\":\"done\",\"summary\":\"ok\"} {}")))
  (is (thrown? Exception
               (parse-agent-answer ImplementationAnswer
                                   "report: {\"outcome\":\"done\",\"summary\":\"ok\"}")))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"schema validation"
                        (parse-agent-answer ImplementationAnswer
                                            "{\"outcome\":\"maybe\",\"summary\":\"ok\"}"))))

(deftest agent-answer-repair-test
  (let [id        "00000000-0000-0000-0000-000000000002"
        pi        {:harness :pi :model "openai-codex/gpt-5.6-sol" :thinking :high :name "GPT-5.6 Sol"}
        responses (atom ["not json"
                         "{\"outcome\":\"maybe\",\"summary\":\"no\"}"
                         "{\"outcome\":\"done\",\"summary\":\"fixed\"}"])
        calls     (atom [])]
    (with-redefs [clojure.core/random-uuid (constantly (java.util.UUID/fromString id))
                  run-process-with-timeout!
                  (fn [argv dir timeout-ms options]
                    (swap! calls conj {:argv       argv
                                       :dir        dir
                                       :timeout-ms timeout-ms
                                       :stdin      (:in options)})
                    (let [out (first @responses)]
                      (swap! responses subvec 1)
                      {:exit 0 :out out :err ""}))]
      (is (= {:agent  {:harness :pi :session-id id :name "GPT-5.6 Sol"}
              :answer {:outcome :done :summary "fixed"}}
             (invoke-agent! "/worktree" "work" ImplementationAnswer pi nil)))
      (is (= 3 (count @calls)))
      (is (every? #(and (pos? (:timeout-ms %))
                        (<= (:timeout-ms %) AGENT-TIMEOUT-MS))
                  @calls))
      (is (every? #(= ["pi"
                       "-p"
                       "--approve"
                       "--model" "openai-codex/gpt-5.6-sol"
                       "--thinking" "high"
                       "--session-id" id]
                      (:argv %))
                  @calls))
      (is (= (md "work" (final-answer-instructions ImplementationAnswer))
             (:stdin (first @calls))))
      (is (every? #(str/includes? (:stdin %)
                                  "Do not modify any files")
                  (rest @calls))))))

(deftest agent-process-failure-is-not-retried-test
  (let [id     "00000000-0000-0000-0000-000000000004"
        pi     {:harness :pi :model "openai-codex/gpt-5.6-sol" :thinking :high :name "GPT-5.6 Sol"}
        calls  (atom 0)
        logged (atom nil)
        error  (try
                 (with-redefs [clojure.core/random-uuid
                               (constantly (java.util.UUID/fromString id))
                               run-process-with-timeout!
                               (fn [_argv _dir _timeout-ms _options]
                                 (swap! calls inc)
                                 {:exit 17 :out "out" :err "err"})
                               write-agent-log!         (fn [_file data] (reset! logged data))]
                   (invoke-agent! "/worktree" "work" ImplementationAnswer pi "/task/agent.log")
                   nil)
                 (catch Exception error error))]
    (is (= 1 @calls))
    (is (= 17 (:status (ex-data error))))
    (is (= "outerr" (:text @logged)))
    (is (= {:harness :pi :session-id id :name "GPT-5.6 Sol"} (:agent @logged)))))

(deftest exhausted-agent-answer-repair-is-logged-test
  (let [id    "00000000-0000-0000-0000-000000000003"
        pi    {:harness :pi :model "openai-codex/gpt-5.6-sol" :thinking :high :name "GPT-5.6 Sol"}
        tmp   (fs/create-temp-dir {:prefix "tasktron-agent-test-"})
        log   (fs/path tmp AGENT-LOG-FILENAME)
        calls (atom 0)
        error (try
                (with-redefs [clojure.core/random-uuid
                              (constantly (java.util.UUID/fromString id))
                              run-process-with-timeout!
                              (fn [_argv _dir _timeout-ms _options]
                                (swap! calls inc)
                                {:exit 0 :out "bad answer" :err ""})]
                  (invoke-agent! "/worktree" "work" ImplementationAnswer pi log)
                  nil)
                (catch Exception error error))]
    (try
      (is (= 3 @calls))
      (is (= {:harness :pi :session-id id :name "GPT-5.6 Sol"} (:agent (ex-data error))))
      (is (= ["bad answer" "bad answer" "bad answer"]
             (:raw-responses (ex-data error))))
      (is (str/includes? (slurp (str log)) id))
      (is (str/includes? (slurp (str log)) "bad answer"))
      (let [failed  (effect-failure-event error)
            stopped (step started-state :a failed)]
        (is (= {:event-name :blocked
                :summary    (ex-message error)
                :agent      {:harness :pi :session-id id :name "GPT-5.6 Sol"}}
               (dissoc (last (history stopped :a)) :at))))
      (finally
        (fs/delete-tree tmp)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; CLI and runtime tests

(deftest progress-reporter-output-test
  (let [state   (assoc started-state :run-started-at TEST-NOW)
        blocked (step state :a {:event-name :blocked :summary "cannot"}
                      (seconds-after 1))
        output  (with-out-str
                  (let [report! (make-progress-reporter false "/task")]
                    (report! state TEST-NOW)
                    (report! blocked (seconds-after 1))))]
    (is (str/includes? output "## T"))
    (is (str/includes? output "[a] A: BLOCKED — cannot")))
  (let [output (with-out-str
                 (let [report! (make-progress-reporter true "/task")
                       state   (assoc started-state :run-started-at TEST-NOW)]
                   (report! state TEST-NOW)
                   (report! state (seconds-after 1))))]
    (is (str/includes? output "\u001b["))
    (is (str/includes? output "\u001b[J"))))

(deftest task-overview-and-status-share-renderer-test
  (let [state   (assoc started-state :run-started-at TEST-NOW)
        at      (seconds-after 65)
        running (render-task-overview state "/task" true at)
        stopped (render-task-overview state "/task" false at)]
    (is (= "## T" (first (str/split-lines running))))
    (is (str/ends-with? (second (str/split-lines running)) "task.md"))
    (is (not (str/includes? running "Progress:")))
    (is (str/includes? running "Run time: 01:05"))
    (is (str/includes? running "Revisions"))
    (is (re-find #"\n   1  A\s+implementing\s+01:05\s+01:05\s+0" running))
    (is (re-find #"\n   2  B\s+pending — waits on 1\s+—\s+—\s+—" running))
    (is (str/includes? stopped "interrupted — was implementing"))
    (with-redefs [live-task-dirs (constantly ["/task"])
                  read-state!    (constantly state)
                  task-running?  (constantly true)
                  now            (constantly at)]
      (is (= (str running "\n")
             (with-out-str (status-cmd test-runtime [])))))))

(deftest run-process-registry-test
  (let [processes (atom #{})]
    (binding [*task-processes* processes]
      (is (= {:exit 0 :out "ok" :err ""}
             (run-process-with-timeout! ["sh" "-c" "printf ok"] "." 1000)))
      (is (empty? @processes)))))

(deftest destroy-process-kills-the-whole-tree-test
  (let [proc     (apply p/process {:out :string :err :string} ["sh" "-c" "sleep 30 & wait"])
        process  (:proc proc)
        handle   (.toHandle process)
        children (loop [attempt 0]
                   (let [descendants (doall (iterator-seq (.iterator (.descendants handle))))]
                     (if (or (seq descendants) (< 100 attempt))
                       descendants
                       (do (Thread/sleep 10)
                           (recur (inc attempt))))))]
    (is (seq children))
    (destroy-process! process)
    (is (not (.isAlive process)))
    (is (not-any? #(.isAlive ^java.lang.ProcessHandle %) children))))

(deftest submitted-effect-cleanup-test
  (let [executor  (java.util.concurrent.Executors/newSingleThreadExecutor)
        completed (java.util.concurrent.LinkedBlockingQueue.)
        worktrees (java.util.concurrent.LinkedBlockingQueue. ["worktree"])]
    (try
      (with-redefs [perform! (fn [& _] (throw (ex-info "boom" {})))]
        (submit-effect! executor completed worktrees nil {:subtask :a})
        (is (= {:subtask :a
                :event   {:event-name :effect-failed :summary "boom"}}
               (.poll completed 1 java.util.concurrent.TimeUnit/SECONDS)))
        (is (= "worktree"
               (.poll worktrees 1 java.util.concurrent.TimeUnit/SECONDS))))
      (finally
        (.shutdownNow executor)))))

(deftest task-run-lock-test
  (let [dir  (fs/create-temp-dir {:prefix "tasktron-lock-test-"})
        lock (acquire-task-lock! dir)]
    (try
      (is (task-running? dir))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"already running"
                            (acquire-task-lock! dir)))
      (finally
        (.close lock)))
    (try
      (is (not (task-running? dir)))
      (finally
        (fs/delete-tree dir)))))

(deftest runtime-and-command-smoke-test
  (let [scoped (task-runtime test-runtime
                             (tasktron-path test-runtime "t")
                             test-state)]
    (is (m/validate Runtime test-runtime))
    (is (m/validate TaskRuntime scoped)))
  (is (= ["new" "refine" "plan" "review-plan" "approve" "run" "retry"
          "status" "validate" "self-test"]
         (mapv (comp :command command-spec) command-vars))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; Parsing tests

(deftest parse-independent-subtasks-test
  (is (= {:title  "Testing tasktron"
          :body   "Let's just test out the tasktron workflow"
          :checks []
          :subtasks
          [{:id           :create-file-a
            :title        "Create file A"
            :dependencies []
            :checks       []
            :body         "Create a file A that contains just the string `aaa`."}
           {:id           :create-file-b
            :title        "Create file B"
            :dependencies []
            :checks       []
            :body         "Create a file B that contains just the string `bbb`."}]}
         (parse-task
          "# Testing tasktron

Let's just test out the tasktron workflow

## Subtasks

### Create file A

Create a file A that contains just the string `aaa`.

### Create file B

Create a file B that contains just the string `bbb`."))))

(deftest parse-frontmatter-test
  (is (= {:title  "Release task"
          :body   "Design."
          :checks ["bb test.clj" "bb lint.clj"]
          :subtasks
          [{:id           :build-assets
            :title        "Build assets"
            :dependencies []
            :checks       []
            :body         "Build them."}
           {:id           :package-release
            :title        "Package release"
            :dependencies [:build-assets :run-tests :lint-code :sign-build]
            :checks       ["test -f release.tar.gz" "tar -tzf release.tar.gz"]
            :body         "Create the archive."}]}
         (parse-task
          "# Release task ###

check: bb test.clj
check: bb lint.clj

Design.

## Subtasks ##

### Build assets

Build them.

### Package release ###

check: test -f release.tar.gz
dependencies: build-assets run-tests,lint-code
dependencies: sign-build build-assets
check: tar -tzf release.tar.gz

Create the archive."))))

(deftest frontmatter-needs-trailing-blank-line-test
  (let [task (parse-task
              "# Onboarding docs
Goal: make setup take under five minutes.
This body line is safe because the key run is not followed by a blank line.

## Subtasks

### Rewrite setup section
Note: keep the tone casual.
The same rule protects this line.")]
    (is (= [] (:checks task)))
    (is (str/starts-with? (:body task) "Goal: make setup"))
    (is (= [] (get-in task [:subtasks 0 :checks])))
    (is (str/starts-with? (get-in task [:subtasks 0 :body])
                          "Note: keep the tone casual."))))

(deftest frontmatter-must-be-leading-test
  (let [task (parse-task
              "# Metadata position

## Subtasks

### A

Write the literal example below.
dependencies: not-frontmatter")]
    (is (= [] (get-in task [:subtasks 0 :dependencies])))
    (is (str/ends-with? (get-in task [:subtasks 0 :body])
                        "dependencies: not-frontmatter"))))

(deftest parse-errors-report-source-lines-test
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 6: dependencies frontmatter must name"
       (parse-task
        "# T

## Subtasks

### A
dependencies:

Body.")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 6: unknown frontmatter key `owner`"
       (parse-task
        "# T

## Subtasks

### A
owner: one
OWNER: two

Body.")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 6: unknown frontmatter key `cheks`"
       (parse-task
        "# T

## Subtasks

### A
cheks: bb test.clj

Body.")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 3: unknown frontmatter key `dependencies`"
       (parse-task
        "# T

dependencies: something

Body.")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 6: check frontmatter must be a shell command"
       (parse-task
        "# T

## Subtasks

### A
check:

Body.")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo #"line 5: subtask heading must"
       (parse-task
        "# T

## Subtasks

###Missing space

Body."))))

(deftest task-validation-test
  (let [invalid (parse-task
                 "# T

## Subtasks

### A B

### A? B
dependencies: Not-a-slug missing

Second.")]
    (is (= ["duplicate subtask id `a-b`"
            "subtask `a-b` has no body"
            "subtask `a-b` has invalid dependency id `Not-a-slug`"
            "subtask `a-b` depends on `missing`, which does not exist"]
           (task-errors invalid))))
  (is (= [(str "The draft has no subtasks; run `" COMMAND-NAME " plan`.")]
         (task-errors
          (parse-task
           "# T

Design only.")))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;; script entry

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
