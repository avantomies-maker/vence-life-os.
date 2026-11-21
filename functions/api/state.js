
const DATABASE_ID = "25f0a419bc77445495617252ad6f4b4c";
const NOTION_VERSION = "2022-06-28";

const HABITS = [
  "Take Vitamins",
  "Back Roller",
  "Back Workout",
  "Stretching",
  "Leg Day",
  "Core / Abs",
  "Chest Workout",
  "Strength", "Cardio", "Mobility", "Reading", "Music", "Gifted Emotions",
  "Planning", "Sleep 7h", "Cold Exposure", "Business Deep Work",
  "Own Path Experiment", "Wealth Check", "Weekly Life Review", "Journaling"
];

function todayInFinland() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z"));
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function notion(env, path, method = "GET", body) {
  if (!env.NOTION_TOKEN) {
    throw new Error("NOTION_TOKEN is not configured");
  }

  const res = await fetch(
    `https://api.notion.com/v1${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Notion API ${res.status}: ${data.message || "Unknown error"}`
    );
  }

  return data;
}

function simplifyPage(page) {
  const props = page.properties || {};
  const result = {
    id: page.id,
    date: props.Date?.date?.start || null,
    name: props.Name?.title?.map(x => x.plain_text).join("") || ""
  };

  for (const habit of HABITS) {
    result[habit] = props[habit]?.checkbox === true;
  }

  return result;
}

async function findDay(env, date) {
  const result = await notion(
    env,
    `/databases/${DATABASE_ID}/query`,
    "POST",
    {
      filter: {
        property: "Date",
        date: { equals: date }
      },
      page_size: 10
    }
  );

  return result.results[0] || null;
}

async function getDays(env) {
  const results = [];
  let cursor;

  do {
    const data = await notion(
      env,
      `/databases/${DATABASE_ID}/query`,
      "POST",
      {
        page_size: 100,
        sorts: [
          {
            property: "Date",
            direction: "descending"
          }
        ],
        ...(cursor ? { start_cursor: cursor } : {})
      }
    );

    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && results.length < 1000);

  return results.map(simplifyPage);
}

export async function onRequestGet({ env }) {
  try {
    const days = await getDays(env);

    return response({
      ok: true,
      today: todayInFinland(),
      habits: HABITS,
      days
    });
  } catch (error) {
    console.error("Notion read error:", error.message);

    return response({
      ok: false,
      error: error.message
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");

    if (origin && origin !== new URL(request.url).origin) {
      return response({
        ok: false,
        error: "Cross-origin writes are not allowed"
      }, 403);
    }

    const body = await request.json();
    const date = body.date || todayInFinland();
    const habit = body.habit;

    if (!validDate(date)) {
      return response({
        ok: false,
        error: "Invalid date"
      }, 400);
    }

    if (!HABITS.includes(habit)) {
      return response({
        ok: false,
        error: "Unknown habit"
      }, 400);
    }

    if (typeof body.checked !== "boolean") {
      return response({
        ok: false,
        error: "checked must be true or false"
      }, 400);
    }

    const existing = await findDay(env, date);

    const properties = {
      [habit]: { checkbox: body.checked }
    };

    let page;

    if (existing) {
      page = await notion(
        env,
        `/pages/${existing.id}`,
        "PATCH",
        { properties }
      );
    } else {
      page = await notion(
        env,
        "/pages",
        "POST",
        {
          parent: {
            database_id: DATABASE_ID
          },
          properties: {
            Name: {
              title: [
                {
                  text: { content: date }
                }
              ]
            },
            Date: {
              date: { start: date }
            },
            ...properties
          }
        }
      );
    }

    return response({
      ok: true,
      day: simplifyPage(page)
    });
  } catch (error) {
    console.error("Notion write error:", error.message);

    return response({
      ok: false,
      error: error.message
    }, 500);
  }
}
