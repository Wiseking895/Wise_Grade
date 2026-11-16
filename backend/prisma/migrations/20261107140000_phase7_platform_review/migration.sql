-- Academic review is performed by platform super administrators, who do not
-- hold a school membership. Preserve historical reviewer ids when present.
ALTER TABLE "ResultReview" ALTER COLUMN "reviewerMembershipId" DROP NOT NULL;
