## Soma Capital Technical Assessment

This is a technical assessment as part of the interview process for Soma Capital.

> [!IMPORTANT]  
> You will need a Pexels API key to complete the technical assessment portion of the application. You can sign up for a free API key at https://www.pexels.com/api/

To begin, clone this repository to your local machine.

## Development

This is a [NextJS](https://nextjs.org) app, with a SQLite based backend, intended to be run with the LTS version of Node.

To run the development server:

```bash
npm i
npx prisma migrate dev
npm run dev
```

Before starting, create a local env file for the Pexels key:

```bash
copy .env.example .env.local
```

Then set:

```bash
PEXELS_API_KEY=your_pexels_api_key_here
```

## Task:

Modify the code to add support for due dates, image previews, and task dependencies.

### Part 1: Due Dates

When a new task is created, users should be able to set a due date.

When showing the task list is shown, it must display the due date, and if the date is past the current time, the due date should be in red.

### Part 2: Image Generation

When a todo is created, search for and display a relevant image to visualize the task to be done.

To do this, make a request to the [Pexels API](https://www.pexels.com/api/) using the task description as a search query. Display the returned image to the user within the appropriate todo item. While the image is being loaded, indicate a loading state.

You will need to sign up for a free Pexels API key to make the fetch request.

### Part 3: Task Dependencies

Implement a task dependency system that allows tasks to depend on other tasks. The system must:

1. Allow tasks to have multiple dependencies
2. Prevent circular dependencies
3. Show the critical path
4. Calculate the earliest possible start date for each task based on its dependencies
5. Visualize the dependency graph

## Submission:

1. Add a new "Solution" section to this README with a description and screenshot or recording of your solution.
2. Push your changes to a public GitHub repository.
3. Submit a link to your repository in the application form.

Thanks for your time and effort. We'll be in touch soon!

## Solution

### Architecture overview

The app keeps the original Next.js + Prisma structure and extends it in place.

- `app/page.tsx` is the main FlowForge OS surface for creation, review, and editing
- `app/api/todos/route.ts` handles creation, reads, dependency-aware inserts, and preview persistence
- `app/api/todos/[id]/route.ts` handles updates, deletes, and cycle-safe dependency changes
- `lib/pexels.ts` contains the server-only Pexels integration
- `lib/dependencyGraph.ts` contains the DAG utilities used by the UI

### Schema changes

The existing `Todo` model was extended rather than replaced.

- `dueDate DateTime?`
- `imageUrl String?`
- `estimatedDurationHours Float?`
- `dependencies Todo[] @relation("TaskDependencies")`
- `dependents Todo[] @relation("TaskDependencies")`

This keeps the current architecture intact while enabling scheduling, previews, and graph analysis.

### Due date logic

- task creation supports an optional `datetime-local` input
- the client converts local datetime input into ISO before sending it to the server
- Prisma persists due dates as `DateTime?`
- the UI formats stored values back into the user's local timezone
- overdue tasks render red
- tasks due within 24 hours render amber with a `Due soon` label
- tasks without a due date render a graceful neutral state

### Pexels integration strategy

- task creation calls `getTaskPreviewImage(taskTitle)` from `lib/pexels.ts`
- the API key is read only from `PEXELS_API_KEY` on the server
- image lookup is time-bounded and wrapped in `try/catch`
- task creation still succeeds even when the Pexels request fails, times out, or returns nothing
- image selection prefers a relevant, optimized source and avoids unnecessary repeats when possible

### Why image URLs are persisted

Image URLs are saved in the database so the app does not hit Pexels on every render. That keeps the UI faster, avoids unnecessary API churn, and gives each task a stable visual identity after creation.

### DAG data model

Dependencies are modeled as a self-referential many-to-many Prisma relation on `Todo`.

- a task can depend on multiple other tasks
- a task can also have multiple downstream dependents
- `estimatedDurationHours` provides edge-free node weights for scheduling and critical path analysis

### Cycle prevention approach

Cycle prevention happens in two places.

1. In the UI, invalid dependency options are disabled before save.
2. On the server, the proposed graph is reconstructed and checked again before updating Prisma.

`lib/dependencyGraph.ts` uses DFS-based cycle detection, and the API returns a clear error message if a circular dependency is attempted.

### Critical path algorithm

The graph utility treats task duration as the node weight.

- topological order is computed first
- longest-path dynamic programming runs over the DAG
- predecessor pointers are stored while propagating durations
- the final path is reconstructed into highlighted node IDs and edge IDs for the UI

### Earliest start propagation

Earliest start is also calculated in topological order.

- root tasks anchor to the current planning reference date
- each dependent task starts at the maximum of all dependency end times
- dependency end time is `earliestStart + estimatedDurationHours`
- missing duration defaults to `1` hour

### React Flow graph design

The graph view uses React Flow with a custom task node.

- left-to-right layout based on dependency depth
- node cards include title, due date, duration, and image preview when available
- critical path edges are thicker and animated
- blocked tasks are visually muted
- overdue tasks get red accents
- due-soon tasks get amber accents
- empty graph states are covered

### UI/UX Redesign

The interface was redesigned into a workflow dashboard with a clear create-review-map structure.

- the left column is a step creation surface
- the center column is an execution lane for current work
- the right column is a critical lane graph for dependency visibility
- urgency states use red for overdue work, amber for due soon, muted zinc for blocked work, and blue accents for critical-path items
- dependency selection supports search plus direct selection from the lane and graph while the picker is open

### Edge cases handled

- blank task titles are rejected
- invalid dates and invalid durations return validation errors
- missing dependencies are rejected server-side
- self-dependency is blocked
- circular dependencies are blocked in the UI and server
- Pexels failures never block task creation
- missing preview images render a placeholder state
- empty task lists and empty dependency graphs have clear states

### Recording

```md
![FlowForge demo](./docs/demo.gif)
```

### Future roadmap

- AI task decomposition
- dependency suggestions
- smart schedule optimization
