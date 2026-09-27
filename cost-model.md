# Cost model: sources and formulas

Use these numbers for `cost-params.ts`. Every fraction is an assumption with a range; sample it, never treat it as exact.



# Cost/Impact Data Sheet: Utility Coordination Value Model
ShellHacks 2026, Sperry Tech GridLock Challenge

This sheet backs the bonus "rough cost/impact estimate" for flagged overlaps between Dominion Energy South Carolina (DESC) and Georgia Power planned transmission projects. DESC filings confirm it builds and rebuilds 115 kV and 230 kV lines in this footprint, so those are the two voltage classes to model.[15] All formulas below are ASSUMPTIONS built on public benchmarks, meant for a Monte Carlo with the ranges given as triangular distributions. No number here is a DESC- or Georgia Power-specific quote; treat every dollar figure as illustrative, not a bid.

## 1. Base construction costs

MISO's MTEP 2018 guide gives detailed per-mile structure and material costs by voltage class for single and double circuit lines; 115 kV and 230 kV are both tabulated with state-level multipliers.[1] EIA-sponsored modeling of WECC's TEPPC cost tool converts to roughly $1.44-1.53 million per mile for extra-high-voltage line infrastructure before terrain adjustment, with total delivered cost (including substations/interconnection) up to $4.2-8.1 million per mile at the high end (2017$, HVDC-scale example, upper-bound sanity check only).[2]

**ASSUMPTION set for the app (default parameters):**
- 115 kV new build: $0.8-1.5 million/mile (midpoint $1.1M)
- 230 kV new build: $1.2-2.5 million/mile (midpoint $1.8M)
- Rebuild/upgrade of existing corridor: 55-75% of new-build cost per mile (midpoint 65%)
- Substation line-position addition: $1.6-3.1 million per position across 69-230 kV per MISO's guide, scaled for inflation to $2-4M in 2025$.[1]

These ranges are wide because national per-mile estimates vary 3-5x with terrain, ROW cost, and permitting complexity; treat as an uncertainty band, not a point estimate.

## 2. Right-of-way, permitting, and access roads

No public source gives a clean "% of project for ROW/permitting" for electric transmission at 40 km scale. The closest quantified analog is fiber/conduit joint-trench economics, where permitting, engineering, and ROW-adjacent costs drive 25-50% of per-mile installed cost, and coordinating with another right-of-way user cut per-mile cost 25-33% for a single shared trench, 40-50% with three entities sharing one trench.[11] ASSUMPTION: apply a 20-35% coordination discount to the ROW/permitting/access-road cost share only (not the full line cost) when projects are touching or crossing, tapering to 5-10% at the 8-40 km tier where crews and equipment overlap but land parcels do not.

## 3. Mobilization, laydown yards, and demobilization

Mobilization/demobilization is commonly its own line item because it is front-loaded; public agencies typically cap it at 5-10% of contract value, and civil contractors report realized mob+demob packages of 4-8% (a $600K project example: $45K mobilization, about 7.5%, plus demobilization at 50-75% of mobilization cost).[13] ASSUMPTION for the app: mobilization + demobilization = 6% of project cost (range 4-10%). When a laydown yard, access road, or crew mobilization is shared, 50-100% of one side's cost is avoidable: touching/crossing and <1.6 km tiers 70-100% shareable; <8 km tier 30-60% via shared yard/deliveries; <40 km tier 10-25% via shared crew/equipment scheduling.

## 4. Freight, trucking, and crew/equipment day rates

**Trucking operating cost:** ATRI's 2025 update puts the 2024 average marginal operating cost of a Class 8 tractor-trailer at $2.260 per mile all-in, or $1.779 per mile excluding fuel; per-hour equivalents are $90.89 and $71.57 at an average 40.2 mph.[7] Sector figures for 2024: specialized carriers $2.32/mile, LTL $2.49/mile, truckload $2.13/mile.[7] Use $2.26/mile as the default heavy-haul operating cost, range $1.78-2.60/mile.

**Crane rental:** Illustrative 2024-2025 vendor rates: small boom trucks $245-260/hour, mid-size 60-90 ton cranes roughly $460/hour, large 150-300 ton units $570-665+/hour; mid-size daily rates commonly $800-1,500/day.[12] BLS reports crane and tower operators average $32.44/hour in base wages (billing rates run higher once overhead and margin are added).[12] ASSUMPTION: use $1,000/day (range $600-2,000/day) as default shared-crane opportunity value.

**Line crew wages:** BLS OEWS May 2023 reports a median hourly wage of $41.07 for electrical power-line installers and repairers, mean $41.30/hour ($85,900/year); the utility-system-construction subsegment averaged $34.19/hour in the prior year's data.[14] ASSUMPTION: a fully loaded crew rate is commonly 2.5-3.5x base wage; use $120/hour per crew person (range $85-160/hour), with a typical crew of 4-6 people.

## 5. Cost of outages and coordination failure

The LBNL ICE Calculator is the standard public tool for translating avoided/added outage minutes into dollars, built from utility customer-interruption-cost surveys under DOE Office of Electricity funding, now in a 2.0 release covering 24 additional utility territories.[4] A distribution-resilience study using the ICE approach adopted a blended average outage cost of $370.20 per customer-hour (2022 USD) across residential, commercial, and industrial customers.[6] Commercial and industrial customers alone reported $500-2,500 per hour in vendor summaries of ICE-style data, consistent with that order of magnitude.[6]

ORNL/DOE found major U.S. power outages (30,000+ customers or 15% of a county) cost customers an average of $67 billion/year over the past seven years, rising to $121 billion in 2024, with commercial/industrial customers averaging $6,031 per major outage event in 2024.[5] This is a national aggregate showing the scale of the problem, not a per-project figure, and should not be rescaled linearly to a single 40 km overlap.

**ASSUMPTION for double-outage avoidance:** if two utilities' planned outages on shared or nearby infrastructure are combined into one outage window instead of two, avoided cost equals (customers affected) x (avoided outage hours) x $370/customer-hour (range $250-500/hour, source [6]), applied only at the touching/crossing and <1.6 km tiers where outage coordination is physically meaningful.

## 6. FERC Order 1920: coordinated regional planning benefits

FERC Order No. 1920 (May 2024, amended by 1920-A/1920-B) requires transmission providers to jointly evaluate seven benefit categories from long-term regional planning, including avoided/deferred reliability facilities, reduced congestion, and extreme-weather mitigation.[8][9] Advocacy analysis citing DOE/industry studies puts U.S. transmission congestion costs at $20.8 billion in 2022, and estimates better-planned transmission investment could add $42 billion to GDP and 400,000+ jobs, plus household savings of $300+/year from expanded transmission paired with cheaper generation.[9] These are regional/national planning figures, not evidence from two crews sharing a laydown yard; use only as pitch-deck context, not as inputs to the savings formula.

## 7. Environmental: shared trips and emissions

EPA's 2025 GHG Emission Factors Hub gives 10.21 kg CO2 per gallon of diesel combusted, and combined medium/heavy-duty truck mobile combustion factors of roughly 1.298 g CH4 and 0.0376 g N2O per vehicle-mile for the 2007+ engine cohort, on top of CO2 from fuel.[10] ASSUMPTION: at 6.5 mpg for a loaded Class 8 truck, that is about 1.57 kg CO2 per mile from fuel alone; avoiding one redundant round-trip haul of L miles saves roughly 2 x L x 1.57 kg CO2, totaled across avoided duplicate trips as a co-benefit metric. The 6.5 mpg figure is an assumption; real heavy-haul mpg for transmission structures/conductor reels varies by load and terrain.

## 8. Proposed savings model per distance tier

For each flagged pair, let C1, C2 be each project's estimated construction cost (Section 1 defaults if not supplied), M = 0.06 x (C1+C2) be combined mobilization/demob cost (Section 3), R = an assumed ROW/permitting cost share of (C1+C2) (Section 2), F = avoided freight cost, and O = avoided outage cost (Section 5). All fractions below are ASSUMPTIONS to sample from the stated ranges in a Monte Carlo, not fixed values.

**Tier 1: Touching/crossing.** Savings = 0.85 x M (range 0.7-1.0) + 0.30 x R (range 0.2-0.35, shared crossing structure design/permits) + O (full double-outage avoidance) + F, where F = (avoided round trips) x (route miles) x $2.26/mile x 2.

**Tier 2: <1.6 km.** Savings = 0.6 x M (range 0.4-0.8, shared access road/staging) + 0.25 x R (range 0.15-0.3, shared permits/easement negotiation) + 0.3 x O (partial outage-window alignment) + F at 50-75% of Tier 1.

**Tier 3: <8 km.** Savings = 0.3 x M (range 0.15-0.45, shared laydown yard/delivery scheduling) + 0.05 x R + F at 25-40% of Tier 1 (shared deliveries reduce some empty-mile trucking; ATRI reports a 16.7% industry average empty-mile share, the baseline inefficiency a shared yard reduces).[7]

**Tier 4: <40 km.** Savings = 0.1 x M (range 0.05-0.15, shared crew/equipment scheduling) + crane/equipment savings = (shared equipment-days avoided) x $1,000/day (range $600-2,000, Section 4).

Sum savings across tiers for a point estimate; for the Monte Carlo, sample each fractional multiplier and dollar rate independently from a triangular distribution using the low/mid/high values above, run 1,000-10,000 draws, and report the 10th/50th/90th percentile total savings per flagged pair. Present as a range labeled "estimated coordination opportunity, not a committed savings figure."

## 9. Sanity-check against the Sperry rep's framing

The rep's stated anchors, a major line outage costing about $1 million/day and a $5 million project carrying about $1 million in unoptimized freight, are consistent in order of magnitude with the benchmarks above: at $370/customer-hour times thousands of customers, a large-line outage reaches six or seven figures per day (Section 5), and freight/logistics commonly running 15-25% of a mid-size transmission project's budget lines up with ATRI's cost structure and the mobilization/logistics shares in Sections 3-4. These anchors came from the rep directly, not from a public source; use the model above to generate comparable, citable ranges rather than substituting the rep's numbers.

## Key caveats

Every figure above is a national or industry-average benchmark, not a DESC- or Georgia Power-specific cost. Actual costs will vary with South Carolina/Georgia terrain, labor markets, and each company's contracting rates. All coordination-savings fractions (0.85, 0.6, 0.3, 0.1, etc.) are this project's assumptions, calibrated to be directionally consistent with the joint-trench evidence in Section 2 but not derived from an electric-transmission-specific coordination study, since none was found publicly. Flag this clearly in the app UI wherever a dollar estimate appears.

## Sources
[1] https://cdn.misoenergy.org/Transmission-and-Substation-Project-Cost-Estimation-Guide-for-MTEP-2018144804.pdf : MISO Transmission and Substation Project Cost Estimation Guide for MTEP 2018
[2] https://www.eia.gov/analysis/studies/electricity/hvdctransmission/pdf/transmission.pdf : EIA - Assessing HVDC Transmission for Impacts of Non-Dispatchable Generation (transmission cost benchmarks)
[4] https://eta-publications.lbl.gov/sites/default/files/interruption_cost_estimate_guidebook_final2_9july2018.pdf : LBNL/DOE - Estimating Power System Interruption Costs: A Guidebook (ICE Calculator), 2018
[5] https://ornl.gov/news/analysis-shows-power-outages-cost-us-electricity-customers-billions : ORNL/DOE - Analysis shows power outages cost US electricity customers billions
[6] https://arxiv.org/html/2407.10773 : Quantifying distribution system resilience from utility data (ICE-based beta=70.2/customer-hour, 2022 USD)
[7] https://truckingresearch.org/wp-content/uploads/2025/07/ATRI-Operational-Costs-of-Trucking-07-2025.pdf : ATRI - An Analysis of the Operational Costs of Trucking: 2025 Update
[8] https://www.ferc.gov/news-events/news/fact-sheet-building-future-through-electric-regional-transmission-planning-and : FERC Fact Sheet - Building for the Future Through Electric Regional Transmission Planning and Cost Allocation (Order No. 1920)
[9] https://westernresourceadvocates.org/wp-content/uploads/2024/11/1920-Fact-Sheet.pdf : Western Resource Advocates - FERC Order No. 1920 Fact Sheet
[10] https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf : EPA GHG Emission Factors Hub 2025
[11] http://rqj.pyz.mybluehost.me/wp-content/uploads/2014/01/CoordinatedConduitConstruction.pdf : CTC Technology & Energy for NATOA/San Francisco - Efficiencies in Communications Construction (coordinated/joint trench savings)
[12] https://centralfloridacraneservice.com/feeds/blog/budgeting-crane-services-construction-projects : Central Florida Crane Service - Crane services budgeting (hourly rates, BLS crane operator wage)
[13] https://constructioncfo.net/civil-contractor-mobilization-demobilization-billing : Construction CFO - Civil Contractor Mobilization and Demobilization Billing
[14] https://www.bls.gov/oes/2023/may/oes499051.htm : BLS OEWS May 2023 - Electrical Power-Line Installers and Repairers wages
[15] https://www.fairfaxcounty.gov/planningcommission/sites/planningcommission/files/assets/documents/pdf/telecommuniactions/dominion%20presentation.pdf : Dominion Energy - Electric Transmission Overview presentation (voltage classes 115/230/500kV)
