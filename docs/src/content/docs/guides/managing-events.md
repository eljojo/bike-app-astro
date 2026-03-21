---
title: Managing events
description: Creating and editing cycling events on the calendar.
---

The event calendar helps riders find group rides, races, festivals, and community events in their city.

<a href="/admin/events" class="city-link">Open the events page &rarr;</a>

## Create an event

1. Go to [the events page](/admin/events) and tap **+ New event**.
2. Fill in the event name and date.
3. Tap **Save**.

That's all you need to get an event on the calendar. Everything else is optional.

## Add details as needed

The event editor starts simple and expands as you need it. Below the date field, you'll see links to reveal additional fields:

- **Set time** — Add a start time. Once set, you can also add an end time.
- **Ends on a different day** — For multi-day events like festivals or tours.
- **Add location** — Street address or venue name.
- **Add distance info** — For rides with set distances, like "10km loop, 25km and 50km options."
- **Add registration link** — URL where riders can sign up.

Only fill in what you know. Fields you don't use stay hidden and won't clutter the event page.

## Upload a poster

If the event has a poster or flyer image:

- Click the **Upload Photo** button in the poster section, or drag the image onto the page.
- A preview appears immediately. Tap **Remove** if you need to swap it.

## Link a community

Events can be linked to a community — a cycling club, shop, or community group.

- Choose from the dropdown of known communities.
- Or tap **or create new** to add a community inline with their name, website, and Instagram.

When a community is linked, their info appears on the event page. They also get their own community page at `/communities/{name}` where riders can find all their upcoming events, social links, and a description of who they are.

## Write a description

The description field supports Markdown. Use it for anything the structured fields don't cover — ride meetup details, what to bring, route descriptions, rain plans.

## Event series

Some events repeat — a weekly group ride, a monthly social, a biweekly workshop. Instead of creating a separate event for each date, you can set one up as a series.

### Setting up a series

1. In the event editor, switch the **Event type** toggle from **Normal event** to **Series**.
2. Choose a mode:
   - **Recurring** — for events that happen on the same day each week or every two weeks.
   - **Specific dates** — for events with irregular scheduling.

### Recurring series

Pick a frequency (weekly or every two weeks), a day of the week, and a season range (start and end dates). The calendar preview fills in all the dates automatically.

- **Skip a date** — click a date on the calendar and choose **Skip**. The date disappears from the series.
- **Cancel a date** — click a date and choose **Cancel date**. It stays on the calendar but shows as cancelled, so riders know it was planned and won't happen.
- **Override a date** — click a date, enter a different location or add a note, then tap **Save override**. Useful when one week moves to a different venue.

### Specific dates

Add dates one at a time using the date picker, or click empty days directly on the calendar. Each date can have its own location. Use this mode for events that don't follow a fixed weekly pattern.

### How series appear on the calendar

Each occurrence shows as its own entry on the calendar, with the date appended to the event name so readers can tell them apart. The event detail page lists all upcoming and past occurrences together, with any per-date notes or location changes.

### Series fields

- **Time** — shared across all occurrences. Tap **Set time** to add one. You can also set a **meet time** (when riders should arrive) that's separate from the roll time.
- **Location** — the default location for the series. Individual dates can override it.
- **Organizer, poster, description** — shared across the whole series, same as normal events.

## Past events

Past events stay in the system as a record of the cycling community's history. Guests and editors can view them but can't make changes. Admins can edit past events if corrections are needed.

## React to events

On any upcoming event page, you'll see two buttons:

- **I want to go** — a public counter. Other riders can see how many people are interested. Useful for gauging turnout.
- **Bookmark** — private to you. Bookmarked events appear at the top of the calendar page and get priority in the "Upcoming events" section on the homepage. A quick way to keep track of events you care about.

Neither requires an account. The first time you tap a button, the site creates a guest session — no email, no signup. Your reactions are saved on that device.

## Save

Tap **Save** when you're done. New events are visible on the calendar after the next site rebuild, usually within a few minutes.
