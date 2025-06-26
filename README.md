# Test-tracker
Scenarios
1. Moniter
2. Get test results.

1.Moniter
	1.same urls can be hit multiple times(with the same dates);('url-> primary key')-> today -> 12 tests -> another -> 12 test (but different) -> isActive/not active -> 30 days -> how many days active
	2. day 1- ID-1234 running , day 2 - ID-1234.

schema - table
1. Tests table - already optimizely - JSON - Date -> new Key -> isActive

// 2. Test ID - [](active) - date\
