/* Static content for Lamp & Light.
   All Scripture quotations are from the King James Version (public domain). */

const BOOKS = [
  ["Genesis", 50], ["Exodus", 40], ["Leviticus", 27], ["Numbers", 36], ["Deuteronomy", 34],
  ["Joshua", 24], ["Judges", 21], ["Ruth", 4], ["1 Samuel", 31], ["2 Samuel", 24],
  ["1 Kings", 22], ["2 Kings", 25], ["1 Chronicles", 29], ["2 Chronicles", 36], ["Ezra", 10],
  ["Nehemiah", 13], ["Esther", 10], ["Job", 42], ["Psalms", 150], ["Proverbs", 31],
  ["Ecclesiastes", 12], ["Song of Solomon", 8], ["Isaiah", 66], ["Jeremiah", 52], ["Lamentations", 5],
  ["Ezekiel", 48], ["Daniel", 12], ["Hosea", 14], ["Joel", 3], ["Amos", 9],
  ["Obadiah", 1], ["Jonah", 4], ["Micah", 7], ["Nahum", 3], ["Habakkuk", 3],
  ["Zephaniah", 3], ["Haggai", 2], ["Zechariah", 14], ["Malachi", 4],
  ["Matthew", 28], ["Mark", 16], ["Luke", 24], ["John", 21], ["Acts", 28],
  ["Romans", 16], ["1 Corinthians", 16], ["2 Corinthians", 13], ["Galatians", 6], ["Ephesians", 6],
  ["Philippians", 4], ["Colossians", 4], ["1 Thessalonians", 5], ["2 Thessalonians", 3], ["1 Timothy", 6],
  ["2 Timothy", 4], ["Titus", 3], ["Philemon", 1], ["Hebrews", 13], ["James", 5],
  ["1 Peter", 5], ["2 Peter", 3], ["1 John", 5], ["2 John", 1], ["3 John", 1],
  ["Jude", 1], ["Revelation", 22]
].map(([name, chapters]) => ({ name, chapters }));

const VERSES = [
  ["John 3:16", "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."],
  ["Proverbs 3:5-6", "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths."],
  ["Philippians 4:6-7", "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus."],
  ["Isaiah 40:31", "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."],
  ["Psalms 119:105", "Thy word is a lamp unto my feet, and a light unto my path."],
  ["Matthew 6:33", "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you."],
  ["Joshua 1:9", "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest."],
  ["Romans 8:28", "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."],
  ["Jeremiah 29:11", "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end."],
  ["Psalms 46:10", "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth."],
  ["Matthew 11:28", "Come unto me, all ye that labour and are heavy laden, and I will give you rest."],
  ["1 John 1:9", "If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness."],
  ["Isaiah 58:6", "Is not this the fast that I have chosen? to loose the bands of wickedness, to undo the heavy burdens, and to let the oppressed go free, and that ye break every yoke?"],
  ["Matthew 6:6", "But thou, when thou prayest, enter into thy closet, and when thou hast shut thy door, pray to thy Father which is in secret; and thy Father which seeth in secret shall reward thee openly."],
  ["Psalms 23:1", "The LORD is my shepherd; I shall not want."],
  ["Hebrews 11:6", "But without faith it is impossible to please him: for he that cometh to God must believe that he is, and that he is a rewarder of them that diligently seek him."],
  ["James 5:16", "Confess your faults one to another, and pray one for another, that ye may be healed. The effectual fervent prayer of a righteous man availeth much."],
  ["Joel 2:12", "Therefore also now, saith the LORD, turn ye even to me with all your heart, and with fasting, and with weeping, and with mourning."],
  ["2 Chronicles 7:14", "If my people, which are called by my name, shall humble themselves, and pray, and seek my face, and turn from their wicked ways; then will I hear from heaven, and will forgive their sin, and will heal their land."],
  ["Lamentations 3:22-23", "It is of the LORD's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness."],
  ["Romans 12:2", "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God."],
  ["Galatians 5:22-23", "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, meekness, temperance: against such there is no law."],
  ["1 Thessalonians 5:16-18", "Rejoice evermore. Pray without ceasing. In every thing give thanks: for this is the will of God in Christ Jesus concerning you."],
  ["2 Timothy 3:16-17", "All scripture is given by inspiration of God, and is profitable for doctrine, for reproof, for correction, for instruction in righteousness: that the man of God may be perfect, throughly furnished unto all good works."]
].map(([ref, text]) => ({ ref, text }));

/* Weekly Bible study lessons — one per week, cycling. */
const LESSONS = [
  {
    title: "The Word of God",
    summary: "Why Scripture deserves first place in our day, and how it shapes the way we live.",
    passage: "Psalms 119:97-112",
    keyVerse: "Psalms 119:105",
    observe: "Read the passage slowly twice. Circle every word the psalmist uses for God's Word (law, testimonies, precepts…). What does he say the Word does for him?",
    questions: [
      "Verse 97 says the psalmist meditates on the law 'all the day'. What would that look like in your routine?",
      "According to verses 98–100, where does true wisdom and understanding come from?",
      "Verse 105 pictures the Word as a lamp. What decision in your life needs that light right now?",
      "What makes it hard for you to stay consistent in reading the Bible, and what one change would help?"
    ],
    apply: "Choose one verse from the passage, write it on a card or phone lock screen, and read it aloud each morning this week.",
    pray: "Ask God to give you a hunger for His Word and to make it the light for the choices you face this week."
  },
  {
    title: "Learning to Pray",
    summary: "Jesus teaches His disciples how to pray with sincerity rather than for show.",
    passage: "Matthew 6:5-15",
    keyVerse: "Matthew 6:6",
    observe: "Notice the contrast between the 'hypocrites' and the disciple who prays in secret. List each part of the Lord's Prayer.",
    questions: [
      "Why do you think Jesus warns against praying to be seen by others?",
      "The prayer begins with God's name, kingdom and will before our needs. Why is that order important?",
      "Which line of the Lord's Prayer is hardest for you to pray honestly? Why?",
      "What connection do verses 14–15 make between prayer and forgiveness?"
    ],
    apply: "Set aside a private place and a fixed time to pray each day this week, using the Lord's Prayer as your outline.",
    pray: "Pray through the Lord's Prayer line by line, pausing to put each phrase into your own words."
  },
  {
    title: "The Fast God Chooses",
    summary: "God describes the kind of fasting that moves His heart — humility joined with justice and mercy.",
    passage: "Isaiah 58:1-12",
    keyVerse: "Isaiah 58:6",
    observe: "What were the people complaining about in verse 3? What was wrong with the way they fasted (verses 3–5)?",
    questions: [
      "List the things God says belong to a true fast in verses 6–7.",
      "What promises does God attach to that kind of fast in verses 8–12?",
      "How can fasting become an empty religious ritual? How do you guard against that?",
      "Who is someone 'afflicted' or in need that you could help during this week's fast?"
    ],
    apply: "On your fasting day, give the cost of the meals you skip — or your time — to someone in need.",
    pray: "Ask God to purify your motives in fasting and to use your fast to loose bands and lift burdens."
  },
  {
    title: "Living by Faith",
    summary: "The heroes of faith show that trusting God means acting on His promises before we see them fulfilled.",
    passage: "Hebrews 11:1-16",
    keyVerse: "Hebrews 11:6",
    observe: "Write a one-sentence definition of faith using verse 1. For each person named, note what they did 'by faith'.",
    questions: [
      "According to verse 6, what two things must a person believe to come to God?",
      "Noah and Abraham obeyed without seeing the whole picture. Where is God asking you to take a step like that?",
      "Verse 13 says they 'died in faith, not having received the promises'. How does that change your view of unanswered prayer?",
      "What 'better country' (verse 16) are you living for?"
    ],
    apply: "Write down one promise of God you are standing on, and one practical act of obedience you will take this week because of it.",
    pray: "Thank God for His faithfulness in the past and ask Him to strengthen your faith in the area where you struggle most."
  },
  {
    title: "Saved by Grace",
    summary: "Paul explains what we were without Christ, what God has done, and what we are now created for.",
    passage: "Ephesians 2:1-10",
    keyVerse: "Ephesians 2:8",
    observe: "Divide the passage into three parts: what we were (1–3), what God did (4–7), and why He did it (8–10).",
    questions: [
      "How does Paul describe our condition before Christ? Why is 'dead' such a strong word?",
      "Verse 4 begins 'But God'. What qualities of God does Paul highlight?",
      "Why is it important that salvation is 'not of works, lest any man should boast'?",
      "Verse 10 says we are created for good works. What good work might God have prepared for you this week?"
    ],
    apply: "Share with one person this week, in your own words, what God's grace means to you.",
    pray: "Thank God specifically for saving you, and surrender your plans so you can walk in the works He prepared."
  },
  {
    title: "The Holy Spirit Our Helper",
    summary: "Jesus promises the Comforter who teaches, reminds, and gives peace to those who love Him.",
    passage: "John 14:15-27",
    keyVerse: "John 14:26",
    observe: "Underline every promise Jesus makes in this passage. What names or titles are given to the Holy Spirit?",
    questions: [
      "How does Jesus link loving Him with keeping His commandments?",
      "What does the Holy Spirit do for believers according to verses 16–17 and 26?",
      "How is the peace Jesus gives different from the peace 'the world giveth'?",
      "In what situation do you most need the Comforter's help today?"
    ],
    apply: "Before reading Scripture each day this week, pause and ask the Holy Spirit to teach you.",
    pray: "Ask to be led and filled by the Holy Spirit, and receive the peace Jesus promised in verse 27."
  },
  {
    title: "The Way of Love",
    summary: "Without love, even great gifts and sacrifices amount to nothing.",
    passage: "1 Corinthians 13:1-13",
    keyVerse: "1 Corinthians 13:13",
    observe: "Make two columns: what love IS and what love is NOT, using verses 4–7.",
    questions: [
      "Why would speaking with the tongues of angels mean nothing without love?",
      "Read verses 4–7 again, replacing 'charity' with your own name. Which line is hardest to say truthfully?",
      "What does it mean that love 'never faileth' when gifts will pass away?",
      "Who is a difficult person God is calling you to love more patiently?"
    ],
    apply: "Do one intentional, unseen act of kindness each day this week.",
    pray: "Ask God to fill you with His love, especially toward the person you named above."
  },
  {
    title: "Forgiving Others",
    summary: "The parable of the unforgiving servant shows how God's mercy to us must flow to others.",
    passage: "Matthew 18:21-35",
    keyVerse: "Matthew 18:35",
    observe: "Compare the size of the two debts in the parable. What does each debt represent?",
    questions: [
      "Why do you think Peter suggested forgiving 'seven times'? What was Jesus' point with 'seventy times seven'?",
      "How did the first servant's attitude change after he was forgiven? Why?",
      "What makes forgiveness so difficult when we have been truly wronged?",
      "Is there someone you still hold a debt against? What would releasing it look like?"
    ],
    apply: "Write the name of someone you need to forgive, pray about it, and take one step toward peace this week.",
    pray: "Thank God for the great debt He forgave you, and ask Him for grace to forgive from the heart."
  },
  {
    title: "Joy in Trials",
    summary: "James teaches how trials develop patience, and how to ask God for wisdom in hard seasons.",
    passage: "James 1:2-18",
    keyVerse: "James 1:5",
    observe: "Trace the chain in verses 3–4: trial → ? → ?. Note what James says about temptation in verses 13–15.",
    questions: [
      "How can we 'count it all joy' when trials come without pretending pain doesn't hurt?",
      "What does verse 5 promise to anyone who lacks wisdom? What condition is given in verse 6?",
      "What is the difference between a trial from God's hand and temptation from our own desires?",
      "What trial are you facing right now, and what might God be growing in you through it?"
    ],
    apply: "Keep a short list this week of every 'good and perfect gift' (verse 17) you notice, even in hard days.",
    pray: "Ask God for wisdom in your current trial and for patience to let it do its full work."
  },
  {
    title: "The Armour of God",
    summary: "Our battle is spiritual, and God has provided everything we need to stand.",
    passage: "Ephesians 6:10-20",
    keyVerse: "Ephesians 6:11",
    observe: "List each piece of armour and what it represents. Notice how many times the word 'stand' appears.",
    questions: [
      "According to verse 12, who is our real enemy? How should that change how we treat people?",
      "Which piece of armour do you most often leave off? What happens when you do?",
      "Why is the Word of God the only offensive weapon listed?",
      "How does prayer (verse 18) connect with the armour?"
    ],
    apply: "Each morning this week, pray through each piece of armour as you get dressed.",
    pray: "Put on the whole armour of God in prayer, and pray for boldness for believers who share the gospel (verses 19–20)."
  },
  {
    title: "A Living Sacrifice",
    summary: "In response to God's mercies, we offer our whole lives and are transformed by a renewed mind.",
    passage: "Romans 12:1-21",
    keyVerse: "Romans 12:2",
    observe: "Notice the word 'therefore' in verse 1. Then list the practical instructions Paul gives in verses 9–21.",
    questions: [
      "What does it mean to present your body as a 'living sacrifice'?",
      "In what ways are you tempted to be 'conformed to this world'?",
      "How does a renewed mind help us discover God's will?",
      "Which command in verses 9–21 challenges you the most this week?"
    ],
    apply: "Identify one habit or input (media, conversation, thought pattern) to replace with something that renews your mind.",
    pray: "Offer yourself to God afresh — your time, body, gifts and relationships — and ask Him to transform your thinking."
  },
  {
    title: "The Blessed Hope",
    summary: "The promise of Christ's return comforts grieving believers and calls us to live watchfully.",
    passage: "1 Thessalonians 4:13-18",
    keyVerse: "1 Thessalonians 4:16",
    observe: "What were the Thessalonians worried about? Put the events of verses 16–17 in order.",
    questions: [
      "Paul says believers grieve, but not 'as others which have no hope'. What is the difference?",
      "How does the certainty of Christ's return give you comfort today?",
      "Verse 18 says to 'comfort one another with these words'. Who needs that comfort from you?",
      "If you knew Jesus would return this month, what would you change?"
    ],
    apply: "Reach out to someone who is grieving or discouraged and encourage them with this hope.",
    pray: "Thank God for the hope of eternal life and ask Him to help you live ready and watchful."
  }
];

/* Weekly fasting & prayer focus — one per week, cycling. */
const FAST_WEEKS = [
  {
    title: "Consecration & Surrender",
    focus: "Begin by giving yourself afresh to God. Ask Him to search your heart, cleanse you, and renew a right spirit within you.",
    scriptures: ["Romans 12:1-2", "Psalms 51:10-12", "1 John 1:9", "Psalms 139:23-24"],
    points: [
      "Thank God for His mercy and for the gift of salvation.",
      "Ask the Holy Spirit to search your heart and reveal anything that grieves Him.",
      "Confess and turn away from every known sin.",
      "Surrender your plans, time, relationships and ambitions to God's will.",
      "Ask for a fresh hunger for God's Word and presence."
    ]
  },
  {
    title: "My Family & Household",
    focus: "Stand in the gap for your family — spouse, children, parents and relatives — asking God to draw each one closer to Him.",
    scriptures: ["Joshua 24:15", "Acts 16:31", "Psalms 127:1", "Deuteronomy 6:6-7"],
    points: [
      "Thank God for each member of your family by name.",
      "Pray for the salvation of family members who do not yet know Christ.",
      "Ask for unity, love and forgiveness where there is conflict.",
      "Pray for protection over your home and for the health of each person.",
      "Ask God to help you be a godly example in your household."
    ]
  },
  {
    title: "Wisdom & Direction",
    focus: "Bring the decisions in front of you to God and ask for wisdom, clarity and the courage to follow His leading.",
    scriptures: ["James 1:5-6", "Proverbs 3:5-6", "Psalms 32:8", "Isaiah 30:21"],
    points: [
      "Thank God that He promises to guide those who trust Him.",
      "Lay out every decision you are facing and ask for His wisdom.",
      "Ask God to close wrong doors and open the right ones.",
      "Pray for discernment to recognise His voice above others.",
      "Commit to obey what He shows you, even when it is difficult."
    ]
  },
  {
    title: "Healing & Wholeness",
    focus: "Pray for healing — physical, emotional and spiritual — for yourself and for those who are sick or hurting.",
    scriptures: ["James 5:14-16", "Isaiah 53:4-5", "Psalms 103:2-5", "Jeremiah 17:14"],
    points: [
      "Thank God for your life and for every blessing of health you enjoy.",
      "Pray by name for people you know who are sick.",
      "Ask God to heal emotional wounds, grief and painful memories.",
      "Pray for doctors, nurses and caregivers to have wisdom and compassion.",
      "Ask for strength and peace for anyone facing long illness."
    ]
  },
  {
    title: "Provision & Work",
    focus: "Trust God as your provider. Pray over your work, finances, and the needs of those who are struggling.",
    scriptures: ["Philippians 4:19", "Deuteronomy 8:18", "Matthew 6:31-33", "Proverbs 16:3"],
    points: [
      "Thank God for daily bread and every way He has provided.",
      "Commit your job, business or studies to the Lord.",
      "Ask for wisdom to manage money faithfully and be free from debt.",
      "Pray for those who are unemployed or in financial hardship.",
      "Ask for a generous heart to bless others with what you have."
    ]
  },
  {
    title: "The Church & Its Leaders",
    focus: "Pray for your local church, pastors and ministry leaders, and for the body of Christ around the world.",
    scriptures: ["1 Timothy 2:1-2", "Ephesians 4:11-13", "John 17:20-21", "Hebrews 13:17"],
    points: [
      "Thank God for your church family and those who teach you His Word.",
      "Pray for your pastors: strength, integrity, wisdom and protection.",
      "Ask for unity and love among believers.",
      "Pray for persecuted Christians around the world.",
      "Ask God to show you how to serve in your local church."
    ]
  },
  {
    title: "Our Nation & Leaders",
    focus: "Humble yourself and intercede for your country, its leaders, and for righteousness, justice and peace in the land.",
    scriptures: ["2 Chronicles 7:14", "Proverbs 14:34", "1 Timothy 2:1-4", "Psalms 33:12"],
    points: [
      "Confess the sins of the nation and ask for God's mercy.",
      "Pray for government leaders to rule with wisdom, justice and humility.",
      "Pray for peace, security and an end to violence and corruption.",
      "Ask God to bless the economy and provide for the poor.",
      "Pray for revival and a turning of hearts to God."
    ]
  },
  {
    title: "Breaking Every Yoke",
    focus: "Seek freedom from habits, fears and strongholds. God's chosen fast looses bands and lets the oppressed go free.",
    scriptures: ["Isaiah 58:6", "2 Corinthians 10:4-5", "John 8:36", "Galatians 5:1"],
    points: [
      "Thank God that whom the Son sets free is free indeed.",
      "Name any habit, addiction or fear that has a hold on you and bring it to Christ.",
      "Ask God to break generational patterns of sin in your family.",
      "Pray for people you know who are bound and oppressed.",
      "Ask for the Holy Spirit's power to walk in daily freedom."
    ]
  },
  {
    title: "Salvation of the Lost",
    focus: "Carry the burden of friends, colleagues and neighbours who do not yet know Jesus, and pray for boldness to share.",
    scriptures: ["Romans 10:1", "2 Peter 3:9", "Luke 19:10", "Matthew 9:37-38"],
    points: [
      "Thank God that He is not willing that any should perish.",
      "Write down and pray for three people who need salvation.",
      "Ask God to open their hearts and remove spiritual blindness.",
      "Pray for labourers to be sent into the harvest.",
      "Ask for boldness and an opportunity to share your testimony this week."
    ]
  },
  {
    title: "Power & Spiritual Gifts",
    focus: "Ask God to empower you by His Spirit to be a faithful witness and to use your gifts for His glory.",
    scriptures: ["Acts 1:8", "1 Corinthians 12:4-7", "Luke 11:13", "2 Timothy 1:6-7"],
    points: [
      "Thank God for the gift of the Holy Spirit.",
      "Ask to be filled afresh with the Spirit.",
      "Ask God to reveal and stir up the gifts He has placed in you.",
      "Pray for the fruit of the Spirit to grow in your character.",
      "Ask for power to be a witness where you live and work."
    ]
  },
  {
    title: "Thanksgiving & Praise",
    focus: "Spend this fast mostly in gratitude. Remember what God has done and worship Him for who He is.",
    scriptures: ["Psalms 100:1-5", "1 Thessalonians 5:16-18", "Psalms 103:1-5", "Philippians 4:6-7"],
    points: [
      "List ten specific things God has done for you this year and thank Him for each.",
      "Praise God for His character: faithful, holy, merciful, good.",
      "Thank God for answered prayers, including the ones answered differently than you asked.",
      "Thank God for people He has placed in your life.",
      "Worship with a psalm or song of praise before breaking your fast."
    ]
  },
  {
    title: "Peace & Protection",
    focus: "Rest under the shadow of the Almighty. Pray for protection, peace of mind, and safety for those you love.",
    scriptures: ["Psalms 91:1-11", "Isaiah 26:3", "John 14:27", "Psalms 121:1-8"],
    points: [
      "Thank God that He is your refuge and fortress.",
      "Cast every anxiety on Him and receive His peace.",
      "Pray for protection over your family, travel, home and work.",
      "Pray for those living in fear, danger or war.",
      "Ask God to keep your mind stayed on Him through the week."
    ]
  }
];

const FAST_TYPES = {
  normal: {
    label: "Normal fast (water only)",
    info: "No food from start to finish; drink plenty of water. The most common weekly fast."
  },
  partial: {
    label: "Partial fast (skip meals)",
    info: "Skip one or two meals — for example, fast until the afternoon — and use mealtimes for prayer."
  },
  daniel: {
    label: "Daniel fast (vegetables & water)",
    info: "Eat only fruits, vegetables, grains and water — no meat, sweets or rich foods (Daniel 1:12; 10:3)."
  },
  media: {
    label: "Media & comfort fast",
    info: "Keep eating normally but give up social media, TV or another comfort, and spend that time in prayer."
  }
};

const FAST_TIPS = [
  "Decide the day, the type of fast and the prayer focus before the day arrives.",
  "Fast as unto God, not to be seen — Jesus taught us to keep it between us and the Father (Matthew 6:17-18).",
  "Drink plenty of water. Avoid heavy meals the night before and break the fast gently with light food.",
  "Replace mealtimes with prayer and Scripture — that is what turns hunger into a spiritual discipline.",
  "Pair your fast with an act of mercy: give, visit, or serve someone in need (Isaiah 58:7).",
  "Write down what you pray for so you can remember and give thanks when God answers.",
  "If you are pregnant, nursing, diabetic, on medication, or have any health condition, speak with your doctor first — choose a Daniel or media fast instead."
];
