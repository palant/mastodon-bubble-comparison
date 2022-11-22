"use strict";

function makeValidUrl(url)
{
  let parsed = new URL(url);
  if (parsed.protocol == "http:" || parsed.protocol == "https:")
    return url;
  else
    return "https://" + url;
}

function restore()
{
  for (let key of Object.keys(localStorage))
  {
    let element = document.getElementById(key);
    if (element && element.localName == "input")
      element.value = localStorage[key];
  }
}

function save(input)
{
  localStorage[input.id] = input.value;
}

function setProgress(text, error = false)
{
  document.getElementById("progress-label").textContent = text;
  if (error)
    document.getElementById("progress").classList.add("error");
  else
    document.getElementById("progress").classList.remove("error");
}

function setError(text)
{
  setProgress(text, true);
}

function parseAccountName(account)
{
  let parts = account.trim().replace(/^@/, "").split("@");
  if (parts.length != 2)
    throw `Unexpected account name ${account}, expected two parts separated by @.`;
  if (/[:\\/]/.test(parts[1]))
    throw `Unexpected account name ${account}, host part cannot contain slashes or colons.`;
  return {
    user: parts[0].trim(),
    host: parts[1].trim()
  };
}

function parseNextLink(link)
{
  for (let entry of String(link).split(/, /))
  {
    let match = /^<(.+?)>;\s*rel="next"/.exec(entry.trim());
    if (match)
      return makeValidUrl(match[1]);
  }

  return null;
}

async function apiCall(host, path)
{
  let url = `https://${host}/api/v1/${path}`;
  let result = null;
  do
  {
    let response = await fetch(url);
    if (result)
      result.push(...await response.json());
    else
      result = await response.json();

    if (Array.isArray(result))
      url = parseNextLink(response.headers.get("link"));
    else
      url = null;
  } while (url);
  return result;
}

async function resolveAccount(account)
{
  let {user, host} = parseAccountName(account);
  let response;
  try
  {
    response = await fetch(`https://${host}/.well-known/webfinger?resource=acct:${user}@${host}`);
  }
  catch (e)
  {
    console.error(e);
    throw `Failed resolving account ${account}, maybe not a Mastodon server?`;
  }
   
  if (response.status == 404)
    throw `Account ${account} does not exist.`;
  else if (response.status != 200)
    throw `Got response ${response.status} resolving account ${account}.`;

  response = await response.json();

  const prefix = "acct:";
  if (!response.subject || !response.subject.startsWith(prefix))
    throw `Unexpected response resolving account ${account}`;

  return parseAccountName(response.subject.slice(prefix.length));
}

function listToMap(list)
{
  let map = new Map();
  for (let account of list)
    map.set(account.url, account);
  return map;
}

function compareLists(followees1, followers1, followees2, followers2, account1, account2)
{
  followees1 = listToMap(followees1);
  followers1 = listToMap(followers1);
  followees2 = listToMap(followees2);
  followers2 = listToMap(followers2);

  let seen = new Set();
  let accepted = [];
  for (let account of [...followees1.values(), ...followers1.values()])
  {
    if (seen.has(account.url))
      continue;
    seen.add(account.url);

    if (!followees2.has(account.url) && !followers2.has(account.url))
      continue;

    let score = 0;
    let note = [];
    if (followees1.has(account.url) && followees2.has(account.url))
    {
      score += 3;
      note.push("followed by both");
    }
    else if (followees1.has(account.url))
    {
      score += 1;
      note.push(`followed by ${account1}`);
    }
    else if (followees2.has(account.url))
    {
      score += 1;
      note.push(`followed by ${account2}`);
    }

    if (followers1.has(account.url) && followers2.has(account.url))
    {
      score += 5;
      note.push("following both");
    }
    else if (followers1.has(account.url))
    {
      score += 2;
      note.push(`following ${account1}`);
    }
    else if (followers2.has(account.url))
    {
      score += 2;
      note.push(`following ${account2}`);
    }

    accepted.push({
      score,
      sortKey: (account.display_name || account.acct).toLowerCase(),
      note: note.join(", "),
      account
    });
  }

  accepted.sort((a, b) =>
  {
    if (a.score != b.score)
      return b.score - a.score;
    else if (a.sortKey < b.sortKey)
      return -1;
    else if (a.sortKey > b.sortKey)
      return 1;
    return 0;
  });

  let output = document.getElementById("result");
  if (accepted.length)
  {
    output.innerText = "";
    for (let {account, note} of accepted)
    {
      let template = document.getElementById("account").content.cloneNode(true);
      template.querySelector(".account").href = makeValidUrl(account.url);

      template.querySelector(".avatar").src = makeValidUrl(account.avatar);

      if (account.display_name)
        template.querySelector(".name").textContent = account.display_name;

      let acct = account.acct;
      if (!acct.includes("@"))
        acct += "@" + new URL(account.url).hostname;
      template.querySelector(".id").textContent = acct;

      template.querySelector(".note").textContent = note;

      output.appendChild(template);
    }
  }
  else
    output.innerText = "No bubble intersections found.";
}

let comparing = false;
async function doCompare()
{
  if (comparing)
    return;

  comparing = true;
  document.getElementById("submit").disabled = true;
  document.getElementById("progress").classList.remove("done");
  try
  {
    let account1 = document.getElementById("account1").value;
    let account2 = document.getElementById("account2").value;
    if (account1 == account2)
      throw "Please enter two different accounts.";

    setProgress(`Resolving account ${account1}.`);
    let {user: user1, host: host1} = await resolveAccount(account1);
    let id1 = (await apiCall(host1, `accounts/lookup?acct=${encodeURIComponent(user1)}`)).id;

    setProgress(`Resolving account ${account2}.`);
    let {user: user2, host: host2} = await resolveAccount(account2);
    let id2 = (await apiCall(host2, `accounts/lookup?acct=${encodeURIComponent(user2)}`)).id;

    if (host1 == host2 && id1 == id2)
      throw `Accounts ${account1} and ${account2} both resolve to the same account.`;

    setProgress(`Fetching ${account1} followees.`);
    let followees1 = await apiCall(host1, `accounts/${encodeURIComponent(id1)}/following?limit=100`);

    setProgress(`Fetching ${account1} followers.`);
    let followers1 = await apiCall(host1, `accounts/${encodeURIComponent(id1)}/followers?limit=100`);

    setProgress(`Fetching ${account2} followees.`);
    let followees2 = await apiCall(host2, `accounts/${encodeURIComponent(id2)}/following?limit=100`);

    setProgress(`Fetching ${account2} followers.`);
    let followers2 = await apiCall(host2, `accounts/${encodeURIComponent(id2)}/followers?limit=100`);

    compareLists(followees1, followers1, followees2, followers2, account1, account2);
  }
  catch (e)
  {
    setError(e.toString());
    if (typeof e != "string")
      console.error(e);
  }
  finally
  {
    comparing = false;
    document.getElementById("submit").disabled = false;
    document.getElementById("progress").classList.add("done");
  }
}
