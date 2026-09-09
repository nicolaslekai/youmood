// youmood rule engine — fast, offline, runs before any AI call.
// Each category: list of case-insensitive patterns (word-boundary where sensible). EN + DE.
(function (root) {
  const W = (s) => new RegExp("(^|[^a-z0-9äöüß])(" + s + ")(?=$|[^a-z0-9äöüß])", "i");
  const CATS = {
    trump: {
      label: "Trump",
      patterns: [W("trump|maga|mar-a-lago|melania|truth social|make america great again")]
    },
    politics: {
      label: "Politics",
      patterns: [W(
        "politics|politik|political|politisch|election|wahl|wahlen|wahlkampf|senate|senat|congress|kongress|parliament|parlament|bundestag|" +
        "republican|republicans|democrat|democrats|gop|biden|kamala|harris|vance|putin|zelensky|selenskyj|netanyahu|erdogan|orban|xi jinping|" +
        "merz|scholz|habeck|weidel|afd|cdu|csu|spd|fdp|grünen|die linke|bsw|" +
        "president|präsident|kanzler|chancellor|government|regierung|minister|ministerin|tariff|tariffs|zölle|" +
        "immigration|migration|deportation|abschiebung|supreme court|impeach|impeachment|white house|weißes haus|kremlin|kreml|" +
        "nato|sanctions|sanktionen|geopolitics|propaganda|left wing|right wing|far-right|rechtsextrem|linksextrem|" +
        "ukraine|gaza|israel|hamas|west bank|ceasefire|waffenruhe"
      )]
    },
    violence: {
      label: "Violence",
      patterns: [W(
        "shooting|shot dead|stabbing|stabbed|murder|murdered|mord|killed|killing|getötet|tötet|massacre|massaker|" +
        "war|krieg|bomb|bombing|bombe|explosion|airstrike|luftangriff|missile|rakete|drone strike|attack|angriff|anschlag|terror|terrorist|" +
        "hostage|geisel|beheaded|execution|hinrichtung|gunfire|shootout|schießerei|brutal|bloody|blutig|" +
        "street fight|fight compilation|knockout|ko compilation|prügelei|schlägerei|police chase|crash compilation|gore|graphic"
      )]
    },
    news: {
      label: "News",
      patterns: [W(
        "breaking|breaking news|eilmeldung|live:|live now|news|nachrichten|" +
        "cnn|bbc|bbc news|fox news|msnbc|nbc news|abc news|cbs news|sky news|dw news|deutsche welle|al jazeera|" +
        "tagesschau|tagesthemen|zdf heute|heute journal|welt|bild|n-tv|ntv|spiegel|focus online|rtl aktuell|reuters|associated press|ap news|" +
        "the guardian|new york times|nyt|washington post|cnbc|bloomberg|euronews|france 24|newsmax|oann|the hill"
      )]
    },
    sport: {
      label: "Sport",
      patterns: [W(
        "football|fußball|fussball|soccer|nfl|nba|mlb|nhl|ufc|mma|boxing|boxen|f1|formula 1|formel 1|" +
        "bundesliga|champions league|premier league|la liga|serie a|ligue 1|europa league|dfb pokal|world cup|weltmeisterschaft|" +
        "olympics|olympia|olympic|tennis|wimbledon|golf|pga|highlights|touchdown|super bowl|playoffs|" +
        "sportschau|espn|dazn|sky sport|fifa|uefa|cricket|rugby|nascar|motogp|wrestling|wwe|aew|" +
        "transfer news|match|spieltag|goal of the|tor des|ski alpin|biathlon|handball|basketball|baseball|hockey|cycling|tour de france|marathon"
      ), /\bvs\.?\s/i]
    },
    ads: {
      label: "Ads",
      patterns: [W("sponsored|gesponsert|anzeige|werbung|paid promotion|bezahlte werbung|#ad|advertisement")]
    },
    brands: {
      label: "Big brands",
      patterns: [W(
        "apple|iphone|ipad|macbook|samsung|galaxy|tesla|nike|adidas|puma|mcdonald's|mcdonalds|burger king|kfc|coca-cola|coca cola|coke|pepsi|" +
        "amazon|google|microsoft|meta|facebook|instagram|tiktok|netflix|disney|starbucks|bmw|mercedes|audi|volkswagen|vw|porsche|toyota|ferrari|lamborghini|" +
        "louis vuitton|gucci|prada|chanel|rolex|red bull|lego|playstation|xbox|nintendo|ikea|zara|h&m|shein|temu|nvidia|intel|openai|spotify|uber|airbnb"
      )]
    }
  };

  function classify(text) {
    const hits = [];
    for (const key in CATS) {
      if (CATS[key].patterns.some((re) => re.test(text))) hits.push(key);
    }
    return hits;
  }

  function customHits(text, words) {
    const t = text.toLowerCase();
    return (words || []).filter((w) => w && t.includes(w.toLowerCase()));
  }

  root.YOUMOOD_RULES = { CATS, classify, customHits };
})(typeof self !== "undefined" ? self : globalThis);
